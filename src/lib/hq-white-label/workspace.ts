/**
 * The partner's HQ WORKSPACE — the tenant record behind /hq/[token].
 *
 * Reads and the lifecycle live here (start a trial, mint the link, resolve
 * a token); what the partner does INSIDE the workspace is in actions.ts,
 * and what they see is shaped in data.ts.
 *
 * Two identities are kept apart on purpose:
 *   - Vendor.portalToken opens the SirReel PARTNER page (their dealings
 *     with us).
 *   - VendorWorkspace.accessToken opens THEIR HQ (their own business).
 * A partner who stops working with SirReel keeps their HQ; a partner who
 * cancels HQ keeps their SirReel page. Neither link opens the other.
 */

import { randomBytes } from 'crypto'
import type { VendorWorkspacePlan, VendorWorkspaceStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { HQ_PRODUCT, trialDaysLeft, vermarOpsEmails } from './product'

export function hqPath(token: string): string {
  return `/hq/${token}`
}

export function hqUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
  return `${base}${hqPath(token)}`
}

/** The "See what HQ can do for you" page, inside the SirReel partner portal. */
export function hqLandingPath(vendorPortalToken: string): string {
  return `/vendor/account/${vendorPortalToken}/hq`
}

export interface HqWorkspace {
  id: string
  vendorId: string
  vendorName: string
  brandName: string
  /** Resolved: theirs, or the product default. */
  accentColor: string
  slug: string
  status: VendorWorkspaceStatus
  plan: VendorWorkspacePlan
  trialEndsAt: string | null
  trialDaysLeft: number | null
  subscribedAt: string | null
  hasLogo: boolean
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  lotAddress: string | null
  accessToken: string
  /** Whether the door is open at all (trial/active) vs. closed. */
  open: boolean
  /** Trial that has run out — open, but the banner says so. */
  trialExpired: boolean
}

const SELECT = {
  id: true, vendorId: true, brandName: true, accentColor: true, slug: true, status: true, plan: true,
  trialEndsAt: true, subscribedAt: true, accessToken: true,
  vendor: { select: { name: true, contactName: true, email: true, phone: true, lotAddress: true, logoUrl: true, logoSvg: true, isActive: true } },
} as const

type Row = {
  id: string; vendorId: string; brandName: string; accentColor: string | null; slug: string
  status: VendorWorkspaceStatus; plan: VendorWorkspacePlan; trialEndsAt: Date | null; subscribedAt: Date | null; accessToken: string | null
  vendor: { name: string; contactName: string | null; email: string | null; phone: string | null; lotAddress: string | null; logoUrl: string | null; logoSvg: string | null; isActive: boolean }
}

function shape(r: Row): HqWorkspace | null {
  if (!r.accessToken) return null
  const open = r.status === 'TRIAL' || r.status === 'ACTIVE'
  const left = r.status === 'TRIAL' ? trialDaysLeft(r.trialEndsAt) : null
  return {
    id: r.id,
    vendorId: r.vendorId,
    vendorName: r.vendor.name,
    brandName: r.brandName,
    accentColor: r.accentColor || HQ_PRODUCT.defaultAccent,
    slug: r.slug,
    status: r.status,
    plan: r.plan,
    trialEndsAt: r.trialEndsAt?.toISOString() ?? null,
    trialDaysLeft: left,
    subscribedAt: r.subscribedAt?.toISOString() ?? null,
    hasLogo: !!(r.vendor.logoSvg || r.vendor.logoUrl),
    contactName: r.vendor.contactName,
    contactEmail: r.vendor.email,
    contactPhone: r.vendor.phone,
    lotAddress: r.vendor.lotAddress,
    accessToken: r.accessToken,
    open,
    trialExpired: r.status === 'TRIAL' && left != null && left < 0,
  }
}

/**
 * Resolve a workspace by its access token. `stamp` bumps the open counter;
 * the shell passes false when the viewer is signed-in SirReel staff so an
 * HQ look never counts as the partner opening it.
 */
export async function loadWorkspaceByToken(token: string, opts: { stamp?: boolean } = {}): Promise<HqWorkspace | null> {
  if (!token || token.length < 32) return null
  const r = await prisma.vendorWorkspace.findUnique({ where: { accessToken: token }, select: SELECT })
  if (!r || !r.vendor.isActive) return null
  if (opts.stamp) {
    prisma.vendorWorkspace
      .update({ where: { id: r.id }, data: { lastOpenedAt: new Date(), openCount: { increment: 1 } } })
      .catch(() => {})
  }
  return shape(r)
}

export async function loadWorkspaceByVendorId(vendorId: string): Promise<HqWorkspace | null> {
  const r = await prisma.vendorWorkspace.findUnique({ where: { vendorId }, select: SELECT })
  return r ? shape(r) : null
}

/** For the SirReel partner page: does this partner have an HQ, and where is it? */
export async function workspaceLinkForVendor(vendorId: string): Promise<{ status: VendorWorkspaceStatus; url: string; trialDaysLeft: number | null } | null> {
  const r = await prisma.vendorWorkspace.findUnique({ where: { vendorId }, select: { status: true, accessToken: true, trialEndsAt: true } })
  if (!r || !r.accessToken) return null
  return { status: r.status, url: hqUrl(r.accessToken), trialDaysLeft: r.status === 'TRIAL' ? trialDaysLeft(r.trialEndsAt) : null }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'workspace'
}

async function uniqueSlug(base: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`
    const clash = await prisma.vendorWorkspace.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!clash) return candidate
  }
  return `${base}-${randomBytes(3).toString('hex')}`
}

/** Tell VerMar — the product's owner, not SirReel's HQ inbox. */
async function tellVerMar(subject: string, line: string, href: string): Promise<void> {
  const to = vermarOpsEmails()
  if (to.length === 0) return
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
  await sendAgreementEmail({
    to,
    subject,
    html: `<p>${line}</p><p><a href="${base}${href}">${base}${href}</a></p>`,
    text: `${line}\n\n${base}${href}`,
    label: 'vermar-hq',
  }).catch(() => null)
}

export interface StartTrialInput {
  requestedByName?: string | null
  requestedByEmail?: string | null
  note?: string | null
}

/**
 * The partner pressed "Start" on the landing page. Idempotent: a partner
 * who already has a workspace gets the same one back (an INTERESTED lead
 * becomes a TRIAL). Mints the access link, emails it to the partner's
 * contact and to whoever pressed the button, and tells HQ.
 */
export async function startWorkspaceTrial(vendorId: string, input: StartTrialInput): Promise<HqWorkspace> {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true, email: true, contactName: true, isActive: true } })
  if (!vendor || !vendor.isActive) throw Object.assign(new Error('partner not found'), { status: 404 })

  const clean = (v: string | null | undefined, max: number) => (v ?? '').trim().slice(0, max) || null
  const requestedByName = clean(input.requestedByName, 120)
  const requestedByEmail = clean(input.requestedByEmail, 200)?.toLowerCase() ?? null
  const note = clean(input.note, 1000)

  const existing = await prisma.vendorWorkspace.findUnique({ where: { vendorId }, select: { id: true, status: true, accessToken: true } })
  const now = new Date()
  const trialEndsAt = new Date(now.getTime() + HQ_PRODUCT.trialDays * 86_400_000)
  let id: string
  let fresh = false
  if (existing) {
    id = existing.id
    const data: Record<string, unknown> = {}
    if (!existing.accessToken) {
      data.accessToken = randomBytes(32).toString('base64url')
      data.accessTokenMintedAt = now
    }
    if (existing.status === 'INTERESTED') {
      Object.assign(data, { status: 'TRIAL', trialStartedAt: now, trialEndsAt, requestedByName, requestedByEmail, requestNote: note })
      fresh = true
    }
    if (Object.keys(data).length) await prisma.vendorWorkspace.update({ where: { id }, data })
  } else {
    const row = await prisma.vendorWorkspace.create({
      data: {
        vendorId,
        brandName: vendor.name,
        slug: await uniqueSlug(slugify(vendor.name)),
        status: 'TRIAL',
        trialStartedAt: now,
        trialEndsAt,
        requestedByName,
        requestedByEmail,
        requestNote: note,
        accessToken: randomBytes(32).toString('base64url'),
        accessTokenMintedAt: now,
      },
      select: { id: true },
    })
    id = row.id
    fresh = true
  }

  const ws = (await prisma.vendorWorkspace.findUnique({ where: { id }, select: SELECT }).then((r) => (r ? shape(r) : null)))!
  const url = hqUrl(ws.accessToken)

  // Their link, by email — the page shows it too, but a link only on a
  // screen is a link that gets lost.
  const recipients = [...new Set([vendor.email, requestedByEmail].filter((e): e is string => !!e))]
  if (recipients.length) {
    const who = requestedByName || vendor.contactName || vendor.name
    await sendAgreementEmail({
      to: recipients,
      subject: fresh ? `Your ${HQ_PRODUCT.name} is ready — ${ws.brandName}` : `Your ${HQ_PRODUCT.name} link — ${ws.brandName}`,
      html: [
        `<p>Hi ${who},</p>`,
        `<p>${fresh ? `Your ${HQ_PRODUCT.name} workspace is set up. Your free trial runs ${HQ_PRODUCT.trialDays} days.` : `Here is the link to your ${HQ_PRODUCT.name} workspace again.`}</p>`,
        `<p><a href="${url}" style="display:inline-block;padding:10px 16px;background:${ws.accentColor};color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Open ${ws.brandName} ${HQ_PRODUCT.name}</a></p>`,
        `<p style="color:#666;font-size:13px">This link is your login — anyone holding it can open your workspace, so share it only with your own team. Bookmark it.</p>`,
        `<p style="color:#666;font-size:13px">${HQ_PRODUCT.name} is made by ${HQ_PRODUCT.maker}. Questions: ${HQ_PRODUCT.supportEmail}</p>`,
      ].join(''),
      text: `Hi ${who},\n\n${fresh ? `Your ${HQ_PRODUCT.name} workspace is set up. Your free trial runs ${HQ_PRODUCT.trialDays} days.` : `Here is the link to your ${HQ_PRODUCT.name} workspace again.`}\n\n${url}\n\nThis link is your login — share it only with your own team.\n\n${HQ_PRODUCT.name} is made by ${HQ_PRODUCT.maker}. Questions: ${HQ_PRODUCT.supportEmail}`,
      label: 'vendor-hq',
    }).catch(() => null)
  }

  if (fresh) {
    await tellVerMar(
      `${vendor.name} started an HQ trial`,
      `${requestedByName || vendor.contactName || 'Someone'} at ${vendor.name}${requestedByEmail ? ` (${requestedByEmail})` : ''} started a ${HQ_PRODUCT.trialDays}-day ${HQ_PRODUCT.name} trial.${note ? ` They wrote: “${note}”` : ''} Trial ends ${trialEndsAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`,
      '/vermar/workspaces',
    )
  }
  return ws
}

/** Rotate the workspace link — the old one dies immediately. Staff-only. */
export async function rotateWorkspaceToken(vendorId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await prisma.vendorWorkspace.update({ where: { vendorId }, data: { accessToken: token, accessTokenMintedAt: new Date() } })
  return token
}
