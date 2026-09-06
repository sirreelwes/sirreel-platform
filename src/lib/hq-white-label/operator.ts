/**
 * VerMar Design's side of the white-label HQ: who OPERATES the product,
 * and the flips they make on a partner's subscription.
 *
 * Wes 2026-09-05: "the control of other HQs should lie with VerMar Design
 * and not within SirReel." So nothing here is a SirReel role. A VerMar
 * operator is an email on this allowlist — Wes as VerMar's owner, plus
 * whoever VERMAR_OPERATOR_EMAILS adds (it ADDS, never replaces, so Wes
 * can delegate without a deploy and can't lock himself out). A SirReel
 * ADMIN who isn't on it — Dani today — has no view of this at all: the
 * partners are VerMar's customers, and their subscriptions, links and
 * trials are VerMar's business.
 *
 * The code is co-hosted in this repo because the product is; the gate,
 * the URL tree (/vermar/*, /api/vermar/*) and the shell are VerMar's.
 */

import type { VendorWorkspacePlan, VendorWorkspaceStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { hqUrl, rotateWorkspaceToken, startWorkspaceTrial } from './workspace'
import { trialDaysLeft } from './product'

const VERMAR_OPERATORS_BASE: ReadonlyArray<string> = ['wes@sirreel.com']

function operatorSet(): Set<string> {
  const set = new Set<string>(VERMAR_OPERATORS_BASE.map((e) => e.toLowerCase()))
  const envRaw = process.env.VERMAR_OPERATOR_EMAILS
  if (envRaw) {
    for (const e of envRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) set.add(e)
  }
  return set
}

/** True only for VerMar Design's operators. */
export function isVerMarOperator(email: string | null | undefined): boolean {
  if (!email) return false
  return operatorSet().has(email.toLowerCase())
}

export const WORKSPACE_STATUSES: VendorWorkspaceStatus[] = ['INTERESTED', 'TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED']
export const WORKSPACE_PLANS: VendorWorkspacePlan[] = ['STARTER', 'PRO']

export interface OperatorWorkspaceRow {
  id: string
  vendorId: string
  vendorName: string
  vendorContact: string | null
  vendorEmail: string | null
  brandName: string
  slug: string
  status: VendorWorkspaceStatus
  plan: VendorWorkspacePlan
  trialStartedAt: string | null
  trialEndsAt: string | null
  trialDaysLeft: number | null
  subscribedAt: string | null
  cancelledAt: string | null
  requestedByName: string | null
  requestedByEmail: string | null
  requestNote: string | null
  url: string | null
  accessTokenMintedAt: string | null
  lastOpenedAt: string | null
  openCount: number
  bookingCount: number
  clientCount: number
  createdAt: string
}

export interface OperatorWorkspaceList {
  workspaces: OperatorWorkspaceRow[]
  /** Active partners with nothing on the books here yet — provisionable. */
  vendorsWithout: { id: string; name: string; contactName: string | null; email: string | null; unitCount: number }[]
}

export async function listWorkspacesForOperator(): Promise<OperatorWorkspaceList> {
  const iso = (d: Date | null) => (d ? d.toISOString() : null)
  const [rows, vendors] = await Promise.all([
    prisma.vendorWorkspace.findMany({
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true, vendorId: true, brandName: true, slug: true, status: true, plan: true,
        trialStartedAt: true, trialEndsAt: true, subscribedAt: true, cancelledAt: true,
        requestedByName: true, requestedByEmail: true, requestNote: true,
        accessToken: true, accessTokenMintedAt: true, lastOpenedAt: true, openCount: true, createdAt: true,
        vendor: { select: { name: true, contactName: true, email: true } },
        _count: { select: { bookings: true, clients: true } },
      },
    }),
    prisma.vendor.findMany({
      where: { isActive: true, workspace: null, subcontractedVehicles: { some: {} } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, contactName: true, email: true, _count: { select: { subcontractedVehicles: true } } },
    }),
  ])
  return {
    workspaces: rows.map((r) => ({
      id: r.id,
      vendorId: r.vendorId,
      vendorName: r.vendor.name,
      vendorContact: r.vendor.contactName,
      vendorEmail: r.vendor.email,
      brandName: r.brandName,
      slug: r.slug,
      status: r.status,
      plan: r.plan,
      trialStartedAt: iso(r.trialStartedAt),
      trialEndsAt: iso(r.trialEndsAt),
      trialDaysLeft: r.status === 'TRIAL' ? trialDaysLeft(r.trialEndsAt) : null,
      subscribedAt: iso(r.subscribedAt),
      cancelledAt: iso(r.cancelledAt),
      requestedByName: r.requestedByName,
      requestedByEmail: r.requestedByEmail,
      requestNote: r.requestNote,
      url: r.accessToken ? hqUrl(r.accessToken) : null,
      accessTokenMintedAt: iso(r.accessTokenMintedAt),
      lastOpenedAt: iso(r.lastOpenedAt),
      openCount: r.openCount,
      bookingCount: r._count.bookings,
      clientCount: r._count.clients,
      createdAt: r.createdAt.toISOString(),
    })),
    vendorsWithout: vendors.map((v) => ({ id: v.id, name: v.name, contactName: v.contactName, email: v.email, unitCount: v._count.subcontractedVehicles })),
  }
}

export interface OperatorWorkspacePatch {
  status?: unknown
  plan?: unknown
  /** YYYY-MM-DD, or null to clear. */
  trialEndsAt?: unknown
}

/**
 * Flip status / plan / trial end. Stamps the lifecycle dates as a side
 * effect (ACTIVE → subscribedAt once; CANCELLED → cancelledAt; reopening
 * clears cancelledAt) and writes one AuditLog row with before/after.
 */
export async function operatorUpdateWorkspace(id: string, patch: OperatorWorkspacePatch, actor: { id: string; email: string }): Promise<void> {
  const before = await prisma.vendorWorkspace.findUnique({
    where: { id },
    select: { status: true, plan: true, trialEndsAt: true, subscribedAt: true, cancelledAt: true, trialStartedAt: true, vendor: { select: { name: true } } },
  })
  if (!before) throw Object.assign(new Error('workspace not found'), { status: 404 })
  const data: Record<string, unknown> = {}
  if (patch.status !== undefined) {
    if (!WORKSPACE_STATUSES.includes(patch.status as VendorWorkspaceStatus)) throw Object.assign(new Error('Unknown status.'), { status: 400 })
    const status = patch.status as VendorWorkspaceStatus
    data.status = status
    if (status === 'ACTIVE' && !before.subscribedAt) data.subscribedAt = new Date()
    if (status === 'CANCELLED') data.cancelledAt = new Date()
    if (status !== 'CANCELLED' && before.cancelledAt) data.cancelledAt = null
    if (status === 'TRIAL' && !before.trialStartedAt) data.trialStartedAt = new Date()
  }
  if (patch.plan !== undefined) {
    if (!WORKSPACE_PLANS.includes(patch.plan as VendorWorkspacePlan)) throw Object.assign(new Error('Unknown plan.'), { status: 400 })
    data.plan = patch.plan
  }
  if (patch.trialEndsAt !== undefined) {
    if (patch.trialEndsAt === null || patch.trialEndsAt === '') data.trialEndsAt = null
    else if (typeof patch.trialEndsAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.trialEndsAt)) {
      // End of that Pacific day, so "ends Oct 5" means the partner has all of Oct 5.
      data.trialEndsAt = new Date(`${patch.trialEndsAt}T23:59:59-07:00`)
    } else throw Object.assign(new Error('Trial end must be a date.'), { status: 400 })
  }
  if (!Object.keys(data).length) return
  await prisma.vendorWorkspace.update({ where: { id }, data })
  await prisma.auditLog
    .create({
      data: {
        userId: actor.id,
        action: 'vendor_workspace.operator_update',
        entityType: 'vendor_workspace',
        entityId: id,
        oldValues: { status: before.status, plan: before.plan, trialEndsAt: before.trialEndsAt?.toISOString() ?? null },
        newValues: { ...(data.status ? { status: data.status } : {}), ...(data.plan ? { plan: data.plan } : {}), ...(patch.trialEndsAt !== undefined ? { trialEndsAt: (data.trialEndsAt as Date | null)?.toISOString() ?? null } : {}), vendor: before.vendor.name, by: actor.email },
      },
    })
    .catch(() => {})
}

/** Issue a new link; the old one dies immediately. Audited. */
export async function operatorRotateWorkspaceLink(id: string, actor: { id: string; email: string }): Promise<string> {
  const ws = await prisma.vendorWorkspace.findUnique({ where: { id }, select: { vendorId: true, vendor: { select: { name: true } } } })
  if (!ws) throw Object.assign(new Error('workspace not found'), { status: 404 })
  const token = await rotateWorkspaceToken(ws.vendorId)
  await prisma.auditLog
    .create({ data: { userId: actor.id, action: 'vendor_workspace.link_rotated', entityType: 'vendor_workspace', entityId: id, newValues: { vendor: ws.vendor.name, by: actor.email } } })
    .catch(() => {})
  return hqUrl(token)
}

/**
 * Provision a workspace for a partner who hasn't pressed the link
 * themselves (VerMar onboarding them). Same path as the partner pressing it — which means the
 * partner's contact IS emailed the link. The UI says so on the button.
 */
export async function operatorProvisionWorkspace(vendorId: string, actor: { id: string; email: string }): Promise<string> {
  const ws = await startWorkspaceTrial(vendorId, { requestedByName: `VerMar Design (${actor.email})`, requestedByEmail: null, note: 'Provisioned by VerMar from /vermar/workspaces' })
  await prisma.auditLog
    .create({ data: { userId: actor.id, action: 'vendor_workspace.provisioned', entityType: 'vendor_workspace', entityId: ws.id, newValues: { vendor: ws.vendorName, by: actor.email } } })
    .catch(() => {})
  return hqUrl(ws.accessToken)
}
