/**
 * GET   /api/incidents/[id] — incident detail incl. linked claims +
 *                              documents + damage rows + the original
 *                              ClaimMail parse when source=EMAIL.
 * PATCH /api/incidents/[id] — update description / occurredAt /
 *                              orderId / assetId / companyId / status.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { IncidentStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: IncidentStatus[] = [
  'OPEN', 'CLAIM_FILED', 'BILLED_RENTER', 'RESOLVED', 'WRITTEN_OFF',
]

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
        // DamageItem has no createdAt column — fall back to ordering
        // by id which is uuid-based and not chronological. Acceptable
        // for the detail view; the UI will display them as a flat list.
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
          id: true, parse: true, reason: true,
          emailMessage: {
            select: {
              id: true, subject: true, fromAddress: true, sentAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!incident) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ incident })
}

interface PatchBody {
  description?: unknown
  occurredAt?: unknown
  orderId?: unknown
  assetId?: unknown
  companyId?: unknown
  status?: unknown
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const me = await requireSession()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

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

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const incident = await prisma.incident.update({
    where: { id }, data,
    select: { id: true, incidentNumber: true, status: true, updatedAt: true },
  }).catch(() => null)
  if (!incident) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true, incident })
}
