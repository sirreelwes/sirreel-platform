/**
 * GET   /api/incidents/[id] — incident detail incl. linked claims +
 *                              documents + damage rows + the original
 *                              ClaimMail parse when source=EMAIL.
 *                              Open to any authenticated session.
 * PATCH /api/incidents/[id] — update description / occurredAt / orderId
 *                              / assetId / companyId / status / severity
 *                              (override; null=auto) / assigneeId /
 *                              nextAction / nextActionDueAt / driverName.
 *                              Gated to canManageClaims (ADMIN + MANAGER
 *                              + AGENT) — see Phase 3 of the claims
 *                              redesign brief.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { IncidentStatus, IncidentSeverity } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getPermissions } from '@/lib/permissions'
import { requireIncidentEditAccess } from '@/lib/incidents/auth'
import {
  computeDerivedSeverity,
  computeRecoveryPosture,
  computeSuggestedNextAction,
  parseCarriesCarrierClaimNumber,
  type IncidentStatusLite,
} from '@/lib/incidents/derive'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: IncidentStatus[] = [
  'OPEN', 'CLAIM_FILED', 'BILLED_RENTER', 'RESOLVED', 'WRITTEN_OFF',
]
const VALID_SEVERITIES: IncidentSeverity[] = ['LITIGATION', 'ROUTINE']

type Params = { params: Promise<{ id: string }> }

async function requireSession() {
  const session = await getServerSession()
  if (!session?.user?.email) return null
  return prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
}

export async function GET(_req: NextRequest, { params }: Params) {
  const me = await requireSession()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const incident = await prisma.incident.findUnique({
    where: { id },
    select: {
      id: true, incidentNumber: true, source: true, status: true,
      description: true, occurredAt: true,
      createdAt: true, updatedAt: true,
      // Phase 3 worklist columns + assignee join — same shape as the
      // LIST endpoint so the detail page can render the Decision Panel.
      severity: true,
      assigneeId: true,
      nextAction: true,
      nextActionDueAt: true,
      driverName: true,
      assignee: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      order:   { select: { id: true, orderNumber: true, jobId: true, bookingId: true } },
      asset:   { select: { id: true, unitName: true, year: true, make: true, model: true } },
      claims:  {
        select: {
          id: true, claimNumber: true, status: true, filedAgainst: true,
          carrierClaimNumber: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      damageItems: {
        select: {
          id: true, damageType: true, severity: true, locationOnVehicle: true,
          estimatedRepairCost: true, disposition: true, invoiceId: true,
          claimId: true,
        },
        orderBy: { id: 'desc' },
      },
      documents: {
        select: {
          id: true, type: true, typeSource: true, typeConfidence: true,
          title: true, fileUrl: true, notes: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      claimMail: {
        select: {
          id: true,
          // Phase 4: inbox cached on ClaimMail — falls back to the
          // EmailAccount.emailAddress join below if absent. Drives the
          // Gmail deep-link's authuser hint in the drawer.
          inbox: true,
          parse: true,
          reason: true,
          emailMessage: {
            select: {
              id: true,
              subject: true,
              fromAddress: true,
              sentAt: true,
              snippet: true,
              attachmentCount: true,
              gmailMessageId: true,
              rfc822MessageId: true,
              emailAccount: { select: { emailAddress: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      _count: { select: { claims: true, damageItems: true, documents: true } },
    },
  })
  if (!incident) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Decision-layer enrichment — same derive helpers the LIST endpoint
  // uses. Read the linked ClaimMail rows' parse + sender to compute
  // derivedSeverity; everything else is local.
  const derivedSeverity = computeDerivedSeverity(
    incident.claimMail.map((m) => ({ parse: m.parse, emailMessage: m.emailMessage })),
  )
  const effectiveSeverity = incident.severity ?? derivedSeverity
  const recoveryPosture = computeRecoveryPosture(
    incident.status as IncidentStatusLite,
    incident._count.claims,
    incident._count.damageItems,
  )
  const parseHasCarrierClaimNumber = incident.claimMail.some((m) =>
    parseCarriesCarrierClaimNumber(m.parse),
  )
  const suggestedNextAction = computeSuggestedNextAction({
    status: incident.status as IncidentStatusLite,
    claimsCount: incident._count.claims,
    damageItemsCount: incident._count.damageItems,
    derivedSeverity,
    parseHasCarrierClaimNumber,
  })

  return NextResponse.json({
    incident: {
      ...incident,
      derivedSeverity,
      effectiveSeverity,
      recoveryPosture,
      suggestedNextAction,
    },
  })
}

interface PatchBody {
  description?: unknown
  occurredAt?: unknown
  orderId?: unknown
  assetId?: unknown
  companyId?: unknown
  status?: unknown
  // Phase 3 worklist fields
  severity?: unknown        // 'LITIGATION' | 'ROUTINE' | null (null clears the override)
  assigneeId?: unknown      // user id or null
  nextAction?: unknown      // string or null
  nextActionDueAt?: unknown // ISO date string or null
  driverName?: unknown      // string or null
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireIncidentEditAccess()
  if (gate instanceof NextResponse) return gate

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as PatchBody

  const data: Record<string, unknown> = {}
  if (body.description !== undefined) {
    if (typeof body.description !== 'string' || body.description.trim().length < 10) {
      return NextResponse.json({ error: 'description must be ≥10 chars' }, { status: 400 })
    }
    data.description = body.description.trim().slice(0, 10_000)
  }
  if (body.occurredAt !== undefined) {
    if (body.occurredAt === null || body.occurredAt === '') {
      data.occurredAt = null
    } else if (typeof body.occurredAt === 'string') {
      const d = new Date(body.occurredAt)
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'invalid occurredAt' }, { status: 400 })
      }
      data.occurredAt = d
    }
  }
  if (body.orderId !== undefined) {
    if (body.orderId === null || body.orderId === '') data.orderId = null
    else if (typeof body.orderId !== 'string') {
      return NextResponse.json({ error: 'orderId must be string or null' }, { status: 400 })
    } else {
      const o = await prisma.order.findUnique({ where: { id: body.orderId }, select: { id: true } })
      if (!o) return NextResponse.json({ error: 'order not found' }, { status: 404 })
      data.orderId = o.id
    }
  }
  if (body.assetId !== undefined) {
    if (body.assetId === null || body.assetId === '') data.assetId = null
    else if (typeof body.assetId !== 'string') {
      return NextResponse.json({ error: 'assetId must be string or null' }, { status: 400 })
    } else {
      const a = await prisma.asset.findUnique({ where: { id: body.assetId }, select: { id: true } })
      if (!a) return NextResponse.json({ error: 'asset not found' }, { status: 404 })
      data.assetId = a.id
    }
  }
  if (body.companyId !== undefined) {
    if (body.companyId === null || body.companyId === '') data.companyId = null
    else if (typeof body.companyId !== 'string') {
      return NextResponse.json({ error: 'companyId must be string or null' }, { status: 400 })
    } else {
      const c = await prisma.company.findUnique({ where: { id: body.companyId }, select: { id: true } })
      if (!c) return NextResponse.json({ error: 'company not found' }, { status: 404 })
      data.companyId = c.id
    }
  }
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !(VALID_STATUSES as string[]).includes(body.status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    }
    data.status = body.status as IncidentStatus
  }

  // ── Phase 3 worklist fields ─────────────────────────────────────
  if (body.severity !== undefined) {
    if (body.severity === null || body.severity === '') {
      // Explicit null = clear the override, fall back to derived.
      data.severity = null
    } else if (typeof body.severity !== 'string' || !(VALID_SEVERITIES as string[]).includes(body.severity)) {
      return NextResponse.json({ error: 'severity must be LITIGATION | ROUTINE | null' }, { status: 400 })
    } else {
      data.severity = body.severity as IncidentSeverity
    }
  }
  if (body.assigneeId !== undefined) {
    if (body.assigneeId === null || body.assigneeId === '') {
      data.assigneeId = null
    } else if (typeof body.assigneeId !== 'string') {
      return NextResponse.json({ error: 'assigneeId must be string or null' }, { status: 400 })
    } else {
      // Confirm the assignee is themselves a claims-eligible user — we
      // don't want a UI hiccup that lets the picker land on a fleet tech.
      const u = await prisma.user.findUnique({
        where: { id: body.assigneeId },
        select: { id: true, role: true, email: true, salesOnly: true },
      })
      if (!u) return NextResponse.json({ error: 'assignee not found' }, { status: 404 })
      const perms = getPermissions({ role: u.role, salesOnly: u.salesOnly, email: u.email })
      if (!perms.canManageClaims) {
        return NextResponse.json({ error: 'assignee lacks canManageClaims' }, { status: 400 })
      }
      data.assigneeId = u.id
    }
  }
  if (body.nextAction !== undefined) {
    if (body.nextAction === null || body.nextAction === '') data.nextAction = null
    else if (typeof body.nextAction !== 'string') {
      return NextResponse.json({ error: 'nextAction must be string or null' }, { status: 400 })
    } else {
      data.nextAction = body.nextAction.trim().slice(0, 2_000)
    }
  }
  if (body.nextActionDueAt !== undefined) {
    if (body.nextActionDueAt === null || body.nextActionDueAt === '') {
      data.nextActionDueAt = null
    } else if (typeof body.nextActionDueAt !== 'string') {
      return NextResponse.json({ error: 'nextActionDueAt must be ISO string or null' }, { status: 400 })
    } else {
      const d = new Date(body.nextActionDueAt)
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'invalid nextActionDueAt' }, { status: 400 })
      }
      data.nextActionDueAt = d
    }
  }
  if (body.driverName !== undefined) {
    if (body.driverName === null || body.driverName === '') data.driverName = null
    else if (typeof body.driverName !== 'string') {
      return NextResponse.json({ error: 'driverName must be string or null' }, { status: 400 })
    } else {
      data.driverName = body.driverName.trim().slice(0, 200)
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const incident = await prisma.incident.update({
    where: { id }, data,
    select: {
      id: true, incidentNumber: true, status: true, updatedAt: true,
      severity: true, assigneeId: true, nextAction: true, nextActionDueAt: true, driverName: true,
      assignee: { select: { id: true, name: true } },
    },
  }).catch(() => null)
  if (!incident) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true, incident })
}
