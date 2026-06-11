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
    },
  })
  return NextResponse.json({ incidents })
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
