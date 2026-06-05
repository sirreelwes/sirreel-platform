/**
 * GET   /api/claims/[id]   — full detail (relations + timeline)
 * PATCH /api/claims/[id]   — update any of: status, financials,
 *                            adjuster details, assignment, notes.
 *
 * PATCH writes a ClaimTimeline row for material transitions
 * (status change, settlement/offer amount changes, adjuster
 * assignment) so the dashboard always has the "why did this
 * change" trail without forcing the rep to log it manually.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import type { ClaimAction, ClaimStatus, Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const CLAIM_STATUSES: ClaimStatus[] = [
  'DRAFT', 'READY_TO_SEND', 'SUBMITTED', 'ACKNOWLEDGED', 'NEGOTIATING',
  'SETTLED', 'DENIED', 'ESCALATED', 'CLOSED',
]
function isClaimStatus(v: unknown): v is ClaimStatus {
  return typeof v === 'string' && CLAIM_STATUSES.includes(v as ClaimStatus)
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params

  const claim = await prisma.insuranceClaim.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      asset: {
        select: {
          id: true, unitName: true, year: true, make: true, model: true, vin: true, licensePlate: true,
          category: { select: { id: true, name: true, slug: true } },
        },
      },
      booking: {
        select: { id: true, bookingNumber: true, jobName: true, productionName: true, startDate: true, endDate: true },
      },
      invoice: {
        select: {
          id: true, invoiceNumber: true, type: true, status: true,
          total: true, amountPaid: true, balanceDue: true,
          order: { select: { id: true, orderNumber: true, jobContactId: true } },
        },
      },
      coiCheck: { select: { id: true, fileUrl: true, aiRiskLevel: true, policyExpiryDate: true } },
      assignedToUser: { select: { id: true, name: true, email: true } },
      damageItems: {
        select: {
          id: true, locationOnVehicle: true, damageType: true, severity: true,
          estimatedRepairCost: true, disposition: true, photoUrl: true,
          inspection: { select: { type: true, inspectionDate: true } },
        },
      },
      timeline: {
        select: {
          id: true, action: true, description: true, amount: true, isAi: true, createdAt: true,
          performedByUser: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
      documents: {
        select: { id: true, type: true, title: true, fileUrl: true, notes: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!claim) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return NextResponse.json({
    claim: {
      ...claim,
      repairEstimate: claim.repairEstimate == null ? null : Number(claim.repairEstimate),
      repairActual: claim.repairActual == null ? null : Number(claim.repairActual),
      dailyRevenueRate: claim.dailyRevenueRate == null ? null : Number(claim.dailyRevenueRate),
      lossOfRevenue: claim.lossOfRevenue == null ? null : Number(claim.lossOfRevenue),
      totalDemand: claim.totalDemand == null ? null : Number(claim.totalDemand),
      amountOffered: claim.amountOffered == null ? null : Number(claim.amountOffered),
      amountSettled: claim.amountSettled == null ? null : Number(claim.amountSettled),
      invoice: claim.invoice
        ? {
            ...claim.invoice,
            total: Number(claim.invoice.total),
            amountPaid: Number(claim.invoice.amountPaid),
            balanceDue: Number(claim.invoice.balanceDue),
          }
        : null,
      damageItems: claim.damageItems.map((d) => ({
        ...d,
        estimatedRepairCost: d.estimatedRepairCost == null ? null : Number(d.estimatedRepairCost),
      })),
      timeline: claim.timeline.map((t) => ({
        ...t,
        amount: t.amount == null ? null : Number(t.amount),
      })),
    },
  })
}

interface PatchBody {
  status?: unknown
  filedAgainst?: unknown
  adjusterName?: unknown
  adjusterPhone?: unknown
  adjusterEmail?: unknown
  policyNumber?: unknown
  repairEstimate?: unknown
  repairActual?: unknown
  repairVendor?: unknown
  daysOutOfService?: unknown
  dailyRevenueRate?: unknown
  lossOfRevenue?: unknown
  totalDemand?: unknown
  amountOffered?: unknown
  amountSettled?: unknown
  assignedTo?: unknown // userId or null to unassign
  notes?: unknown
}

function asString(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length === 0 ? null : t.length > max ? t.slice(0, max) : t
}
function asDecimal(v: unknown): Prisma.Decimal | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  return new (require('@prisma/client/runtime/library').Decimal)(n)
}
function asInt(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  return Math.trunc(n)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as PatchBody

  const existing = await prisma.insuranceClaim.findUnique({
    where: { id },
    select: {
      status: true, amountSettled: true, amountOffered: true,
      assignedTo: true,
      submittedAt: true, settledAt: true,
    },
  })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const data: Prisma.InsuranceClaimUpdateInput = {}
  const timelineEvents: { action: ClaimAction; description: string; amount?: Prisma.Decimal | null }[] = []

  // Status transition — also auto-stamps submittedAt / settledAt the
  // first time we land on SUBMITTED / SETTLED, mirroring the
  // existing column semantics.
  if (body.status !== undefined) {
    if (!isClaimStatus(body.status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    }
    if (body.status !== existing.status) {
      data.status = body.status
      if (body.status === 'SUBMITTED' && !existing.submittedAt) {
        data.submittedAt = new Date()
      }
      if (body.status === 'SETTLED' && !existing.settledAt) {
        data.settledAt = new Date()
      }
      const action: ClaimAction =
        body.status === 'SUBMITTED' ? 'SUBMITTED' :
        body.status === 'SETTLED' ? 'SETTLED' :
        body.status === 'DENIED' ? 'DENIED' :
        body.status === 'ESCALATED' ? 'ESCALATED' :
        'NEGOTIATION_NOTE'
      timelineEvents.push({
        action,
        description: `Status: ${existing.status} → ${body.status}`,
      })
    }
  }

  const filedAgainst = asString(body.filedAgainst, 200)
  if (filedAgainst !== undefined) data.filedAgainst = filedAgainst ?? ''
  const adjusterName = asString(body.adjusterName, 200)
  if (adjusterName !== undefined) data.adjusterName = adjusterName
  const adjusterPhone = asString(body.adjusterPhone, 50)
  if (adjusterPhone !== undefined) data.adjusterPhone = adjusterPhone
  const adjusterEmail = asString(body.adjusterEmail, 200)
  if (adjusterEmail !== undefined) data.adjusterEmail = adjusterEmail
  const policyNumber = asString(body.policyNumber, 100)
  if (policyNumber !== undefined) data.policyNumber = policyNumber
  const repairVendor = asString(body.repairVendor, 200)
  if (repairVendor !== undefined) data.repairVendor = repairVendor
  const notes = asString(body.notes, 20_000)
  if (notes !== undefined) data.notes = notes

  // Money fields — log timeline events for offer/settlement changes
  // (the two numbers reps will look back at first).
  const repairEstimate = asDecimal(body.repairEstimate)
  if (repairEstimate !== undefined) data.repairEstimate = repairEstimate
  const repairActual = asDecimal(body.repairActual)
  if (repairActual !== undefined) data.repairActual = repairActual
  const dailyRevenueRate = asDecimal(body.dailyRevenueRate)
  if (dailyRevenueRate !== undefined) data.dailyRevenueRate = dailyRevenueRate
  const lossOfRevenue = asDecimal(body.lossOfRevenue)
  if (lossOfRevenue !== undefined) data.lossOfRevenue = lossOfRevenue
  const totalDemand = asDecimal(body.totalDemand)
  if (totalDemand !== undefined) data.totalDemand = totalDemand
  const daysOOS = asInt(body.daysOutOfService)
  if (daysOOS !== undefined) data.daysOutOfService = daysOOS

  const amountOffered = asDecimal(body.amountOffered)
  if (amountOffered !== undefined) {
    data.amountOffered = amountOffered
    const prev = existing.amountOffered == null ? null : Number(existing.amountOffered)
    const next = amountOffered == null ? null : Number(amountOffered)
    if (prev !== next) {
      timelineEvents.push({
        action: 'OFFER_RECEIVED',
        description: prev == null
          ? `Offer recorded.`
          : `Offer revised from $${prev.toLocaleString()}.`,
        amount: amountOffered,
      })
    }
  }
  const amountSettled = asDecimal(body.amountSettled)
  if (amountSettled !== undefined) {
    data.amountSettled = amountSettled
    const prev = existing.amountSettled == null ? null : Number(existing.amountSettled)
    const next = amountSettled == null ? null : Number(amountSettled)
    if (prev !== next && next != null) {
      timelineEvents.push({
        action: 'SETTLED',
        description: prev == null
          ? `Settlement recorded.`
          : `Settlement revised from $${prev.toLocaleString()}.`,
        amount: amountSettled,
      })
    }
  }

  // Assignment change — go through the relation since the FK scalar
  // (`assignedTo`) isn't exposed on InsuranceClaimUpdateInput
  // (Prisma quirk when the FK column shares the relation's body name).
  if (body.assignedTo !== undefined) {
    const newId = body.assignedTo === null ? null : asString(body.assignedTo, 100) ?? null
    if (newId !== existing.assignedTo) {
      data.assignedToUser = newId
        ? { connect: { id: newId } }
        : { disconnect: true }
      if (newId) {
        const u = await prisma.user.findUnique({ where: { id: newId }, select: { name: true } })
        timelineEvents.push({
          action: 'ADJUSTER_ASSIGNED',
          description: u ? `Assigned to ${u.name}.` : 'Assigned.',
        })
      } else {
        timelineEvents.push({
          action: 'NEGOTIATION_NOTE',
          description: 'Unassigned.',
        })
      }
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, changed: false })
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.insuranceClaim.update({
      where: { id },
      data,
      select: { id: true, status: true, updatedAt: true },
    })
    for (const ev of timelineEvents) {
      await tx.claimTimeline.create({
        data: {
          claimId: id,
          action: ev.action,
          description: ev.description,
          amount: ev.amount ?? null,
          performedBy: me.id,
        },
      })
    }
    return updated
  })

  return NextResponse.json({ ok: true, claim: result, eventsLogged: timelineEvents.length })
}
