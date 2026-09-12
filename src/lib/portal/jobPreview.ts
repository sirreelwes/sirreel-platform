/**
 * "See what they see" — a staff preview of a client's job portal.
 *
 * Wes 2026-09-12, looking at the job portal: "is there a button to 'see what
 * they see' on job portal page?" There wasn't. Company, person, vendor and
 * driver portals all had a staff preview; the JOB portal — the one every
 * client actually opens — had none, so the only way to look was to open the
 * client's own magic link, which stamps their access row, inflates their
 * "opened 4×" counter and fires the first-open alert to HQ as if they had
 * read it.
 *
 * TWO COOKIES, NOT ONE. The preview never mints a PortalAccess and never
 * writes a real job session: it sets its own cookie, and
 * `verifyJobSessionCookieValue` cannot read it (a preview payload carries no
 * portalAccessId, so the existing check rejects it). That is the safety
 * property, and it is default-DENY: every one of the thirty-odd portal
 * routes refuses a preview cookie until someone deliberately opts it in
 * through `resolveJobPortalRead` below. A route added next year is safe
 * without its author knowing this file exists — and nothing on the page can
 * sign an agreement, approve a quote or pay an invoice while previewing,
 * because those routes never see a session at all.
 *
 * TWO HOSTS. Staff are on hq.sirreel.com; the portal is served from
 * tsx.sirreel.com (portalUrl.ts). A cookie set by HQ cannot be read there, so
 * the button carries a short-lived SIGNED TOKEN to the portal host, which
 * redeems it for the preview cookie. Same stateless HMAC pattern as
 * portal/authorizeToken and sub-rentals/partnerActionCode: signed with
 * NEXTAUTH_SECRET, ten minutes, nothing stored.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession, type ResolvedPortalAccess } from '@/lib/portal/jobMagicLink'

/** Long enough to walk from the job page to the portal, short enough that a
 *  pasted link is useless by the time it reaches anyone else. */
const TOKEN_TTL_MS = 10 * 60_000
/** How long a preview lasts once redeemed. */
const PREVIEW_TTL_MS = 60 * 60_000

export const JOB_PREVIEW_COOKIE = 'sr_portal_preview'

interface PreviewPayload {
  /** The order whose portal is being previewed. */
  previewOrderId: string
  /** Staff email, so the banner can say whose preview this is. */
  by: string
  exp: number
}

function getSecret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.PORTAL_SESSION_SECRET
  if (!s) throw new Error('NEXTAUTH_SECRET not set — cannot sign portal previews')
  return s
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromB64url(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')
  return Buffer.from(padded, 'base64')
}

function sign(payload: PreviewPayload): string {
  const head = b64url(JSON.stringify(payload))
  return `${head}.${b64url(createHmac('sha256', getSecret()).update(head).digest())}`
}

function verify(value: string | undefined | null): PreviewPayload | null {
  if (!value || typeof value !== 'string') return null
  const dot = value.indexOf('.')
  if (dot <= 0 || dot === value.length - 1) return null
  const head = value.slice(0, dot)
  let expected: Buffer
  let received: Buffer
  try {
    expected = createHmac('sha256', getSecret()).update(head).digest()
    received = fromB64url(value.slice(dot + 1))
  } catch {
    return null
  }
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null
  let payload: PreviewPayload
  try {
    payload = JSON.parse(fromB64url(head).toString('utf-8'))
  } catch {
    return null
  }
  if (typeof payload.previewOrderId !== 'string' || typeof payload.exp !== 'number') return null
  if (payload.exp < Date.now()) return null
  return payload
}

/** The token the staff button carries to the portal host. */
export function mintJobPreviewToken(orderId: string, by: string): string {
  return sign({ previewOrderId: orderId, by, exp: Date.now() + TOKEN_TTL_MS })
}

/** Redeem side: what the portal host got handed. */
export function readJobPreviewToken(token: string | undefined | null): { orderId: string; by: string } | null {
  const p = verify(token)
  return p ? { orderId: p.previewOrderId, by: p.by } : null
}

/** The cookie the portal host sets once the token checks out. */
export function createJobPreviewCookieValue(orderId: string, by: string): string {
  return sign({ previewOrderId: orderId, by, exp: Date.now() + PREVIEW_TTL_MS })
}

export function verifyJobPreviewCookieValue(cookie: string | undefined | null): { orderId: string; by: string } | null {
  const p = verify(cookie)
  return p ? { orderId: p.previewOrderId, by: p.by } : null
}

export function buildJobPreviewCookieHeader(value: string, opts: { clear?: boolean } = {}): string {
  if (opts.clear) return `${JOB_PREVIEW_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  return `${JOB_PREVIEW_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(PREVIEW_TTL_MS / 1000)}`
}

/**
 * Build the same shape a real session resolves to, from the order alone.
 * Touches nothing: no PortalAccess row, no lastAccessedAt, no accessCount, no
 * first-open alert. The "contact" is whoever the client would most likely be
 * — the order's primary job contact — because the portal greets them by name
 * and a preview that greets nobody does not show what they see.
 */
export async function resolvePreviewAccess(orderId: string): Promise<ResolvedPortalAccess | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      portalSlug: true,
      portalSunsetAt: true,
      company: { select: { id: true, name: true } },
      job: {
        select: {
          jobContacts: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            select: { person: { select: { id: true, firstName: true, lastName: true, email: true } } },
          },
        },
      },
    },
  })
  if (!order || !order.company) return null
  const person = order.job?.jobContacts[0]?.person ?? null
  return {
    // No row exists, and nothing may write against this id — every write path
    // refuses a preview cookie before it gets here.
    portalAccessId: 'preview',
    orderId: order.id,
    contactId: person?.id ?? 'preview',
    contact: person
      ? { id: person.id, firstName: person.firstName, lastName: person.lastName ?? '', email: person.email ?? '' }
      : { id: 'preview', firstName: 'Staff', lastName: 'Preview', email: '' },
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      portalSlug: order.portalSlug,
      company: order.company,
      portalSunsetAt: order.portalSunsetAt,
    },
  }
}

export interface JobPortalRead {
  resolved: ResolvedPortalAccess
  /** Who is previewing, or null when this is a real client session. */
  previewBy: string | null
}

/**
 * What a READ-ONLY portal route should call instead of
 * `verifyJobSessionCookieValue` + `resolveJobSession`. A real client session
 * wins; a preview cookie is honoured only here. Write routes must keep using
 * the session pair directly, which is what makes them refuse a preview.
 */
export async function resolveJobPortalRead(req: NextRequest): Promise<JobPortalRead | null> {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (session) {
    const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
    return resolved ? { resolved, previewBy: null } : null
  }
  const preview = verifyJobPreviewCookieValue(req.cookies.get(JOB_PREVIEW_COOKIE)?.value)
  if (!preview) return null
  const resolved = await resolvePreviewAccess(preview.orderId)
  return resolved ? { resolved, previewBy: preview.by } : null
}
