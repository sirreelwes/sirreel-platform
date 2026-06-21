/**
 * GET  /api/incidents — list incidents, newest first, optional status filter.
 * POST /api/incidents — manual create ("+ New incident").
 *
 * Manual create is the third entry point alongside EMAIL (claim-mail
 * triage) and RETURN_INSPECTION (future bridge). Stamps source=MANUAL.
 * Auth: getServerSession.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { IncidentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { nextIncidentNumber } from '@/lib/orders'
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

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const sp = new URL(req.url).searchParams
  const statusParam = sp.get('status')
  const status = statusParam && (VALID_STATUSES as string[]).includes(statusParam)
    ? (statusParam as IncidentStatus)
    : null

  const incidents = await prisma.incident.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, incidentNumber: true, source: true, status: true,
      description: true, occurredAt: true,
      createdAt: true, updatedAt: true,
      company: { select: { id: true, name: true } },
      order:   { select: { id: true, orderNumber: true } },
      asset:   { select: { id: true, unitName: true } },
      _count:  { select: { claims: true, damageItems: true, documents: true } },
      // First child claim for the "carrier: X · claim #Y" key-facts
      // line on the decision-first card. Most incidents have 0 or 1
      // claim; multi-claim ones still surface the oldest claim's
      // identity (the canonical one).
      claims: {
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { id: true, claimNumber: true, filedAgainst: true, carrierClaimNumber: true, status: true },
      },
    },
  })

  // Phase 2 enrichment — derived facets. ONE extra query to pull every
  // linked ClaimMail row for the incidents in this page, then we
  // group + derive in-process. Cost is O(N_mail + N_incidents); for
  // the take:200 cap this is a sub-second add.
  const incidentIds = incidents.map((i) => i.id)
  const mailRows = incidentIds.length
    ? await prisma.claimMail.findMany({
        where: { incidentId: { in: incidentIds } },
        select: {
          incidentId: true,
          parse: true,
          createdAt: true,
          emailMessage: {
            select: { fromAddress: true, sentAt: true, attachmentCount: true },
          },
        },
      })
    : []

  const mailByIncident = new Map<string, typeof mailRows>()
  for (const m of mailRows) {
    if (!m.incidentId) continue
    const arr = mailByIncident.get(m.incidentId) ?? []
    arr.push(m)
    mailByIncident.set(m.incidentId, arr)
  }

  const enriched = incidents.map((inc) => {
    const mail = mailByIncident.get(inc.id) ?? []
    const derivedSeverity = computeDerivedSeverity(
      mail.map((m) => ({ parse: m.parse, emailMessage: m.emailMessage })),
    )
    const recoveryPosture = computeRecoveryPosture(
      inc.status as IncidentStatusLite,
      inc._count.claims,
      inc._count.damageItems,
    )
    const parseHasCarrierClaimNumber = mail.some((m) =>
      parseCarriesCarrierClaimNumber(m.parse),
    )
    const suggestedNextAction = computeSuggestedNextAction({
      status: inc.status as IncidentStatusLite,
      claimsCount: inc._count.claims,
      damageItemsCount: inc._count.damageItems,
      derivedSeverity,
      parseHasCarrierClaimNumber,
    })

    // latestActivityAt: max of mail sentAt (best signal) falls back to
    // incident.updatedAt so cards with zero linked mail still sort.
    let latestActivityMs = new Date(inc.updatedAt).getTime()
    for (const m of mail) {
      const t = new Date(m.emailMessage.sentAt).getTime()
      if (Number.isFinite(t) && t > latestActivityMs) latestActivityMs = t
    }
    const totalAttachments = mail.reduce((s, m) => s + (m.emailMessage.attachmentCount || 0), 0)

    return {
      ...inc,
      // Render numerics as numbers; Prisma already does for Int columns.
      // First-child claim is at most one row; keep the array for shape
      // forward-compat and let the UI read [0].
      firstClaim: inc.claims[0] ?? null,
      derivedSeverity,
      recoveryPosture,
      suggestedNextAction,
      messageCount: mail.length,
      totalAttachments,
      latestActivityAt: new Date(latestActivityMs).toISOString(),
    }
  })

  return NextResponse.json({ incidents: enriched })
}

interface CreateBody {
  description?: unknown
  occurredAt?: unknown
  orderId?: unknown
  assetId?: unknown
  companyId?: unknown
}

function asString(v: unknown, max = 5000): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length === 0 ? null : t.slice(0, max)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as CreateBody

  const description = asString(body.description, 10_000)
  if (!description || description.length < 10) {
    return NextResponse.json(
      { error: 'description required (≥10 chars)' },
      { status: 400 },
    )
  }

  const orderId = asString(body.orderId, 100)
  const assetId = asString(body.assetId, 100)
  const companyId = asString(body.companyId, 100)
  const occurredAtRaw = asString(body.occurredAt, 30)
  let occurredAt: Date | null = null
  if (occurredAtRaw) {
    const d = new Date(occurredAtRaw)
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'occurredAt must be a valid date' }, { status: 400 })
    }
    occurredAt = d
  }

  // Verify FKs when supplied. Per the schema, all three are nullable —
  // a manual incident can exist with nothing but a description, in case
  // the rep doesn't yet know which order/asset/company it ties to.
  if (orderId) {
    const o = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } })
    if (!o) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  }
  if (assetId) {
    const a = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true } })
    if (!a) return NextResponse.json({ error: 'asset not found' }, { status: 404 })
  }
  if (companyId) {
    const c = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } })
    if (!c) return NextResponse.json({ error: 'company not found' }, { status: 404 })
  }

  const incidentNumber = await nextIncidentNumber()
  const incident = await prisma.incident.create({
    data: {
      incidentNumber,
      source: 'MANUAL',
      status: 'OPEN',
      description,
      occurredAt,
      orderId,
      assetId,
      companyId,
      createdById: me.id,
    },
    select: {
      id: true, incidentNumber: true, source: true, status: true,
      description: true, occurredAt: true, createdAt: true,
    },
  })

  return NextResponse.json({ ok: true, incident }, { status: 201 })
}
