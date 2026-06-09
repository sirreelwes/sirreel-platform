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
import { computeClaimBadgeFacts } from '@/lib/claims/claimBadges'
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
          dueDate: true, sentAt: true, paidAt: true,
          order: {
            select: {
              id: true, orderNumber: true, jobContactId: true,
              // The renter-side primary contact for the order — the
              // "who do I call at the renter to ask about the loss"
              // gap. Walks order.jobContact (Person) directly.
              jobContact: {
                select: { id: true, firstName: true, lastName: true, email: true, phone: true, mobile: true },
              },
              // Fallback: the Job's contact roster, so the panel can
              // still surface a contact when jobContact is null.
              job: {
                select: {
                  id: true, jobCode: true, name: true,
                  jobContacts: {
                    select: {
                      role: true, isPrimary: true,
                      person: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
                    },
                    orderBy: [{ isPrimary: 'desc' }, { role: 'asc' }],
                  },
                },
              },
            },
          },
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
        select: {
          id: true, type: true,
          // Provenance + confidence drive the "review this AI suggestion"
          // chip in the typed document list (STEP 4). NULL on legacy rows
          // — UI treats null as "user-set, no review needed".
          typeSource: true, typeConfidence: true,
          title: true, fileUrl: true, notes: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!claim) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Decimal → Number for the wire. Doing the conversion here once so
  // the client doesn't carry a Decimal lib.
  const num = (v: { toString(): string } | null | undefined): number | null =>
    v == null ? null : Number(v)

  // Ledger composition — read-time, derived from existing columns.
  //   CONTRACT side comes from the linked LD Invoice:
  //     billed       = invoice.total
  //     paid         = invoice.amountPaid
  //     balanceDue   = invoice.balanceDue (what the renter owes US
  //                                        per the LD invoice, gross)
  //   INSURANCE side comes from the claim:
  //     lossAmount   — replacement-cost anchor
  //     acvReceived  — carrier valuation
  //     depreciationApplied
  //     amountOffered / amountSettled (GROSS — see schema comment)
  //     deductibleAmount
  //     adminFeeAmount
  //   CLIENT EXPOSURE — the goal metric:
  //     = LD balanceDue − (amountSettled − deductibleAmount),
  //       floored at 0
  //   When the carrier hasn't settled yet, exposure falls back to the
  //   full LD balance (no insurance offset to apply). When there's no
  //   LD invoice at all (onboarded claim), the contract side falls
  //   back to claim.contractAmount — the rep-captured "what we billed
  //   the client" figure. Exposure is null only when BOTH the LD
  //   invoice and contractAmount are missing.
  const ldBalanceDue = claim.invoice && claim.invoice.type === 'LD'
    ? Number(claim.invoice.balanceDue)
    : null
  const contractAmount = num(claim.contractAmount)
  // contractBilled comes from the LD invoice when linked, else from
  // the rep-captured contractAmount field.
  const contractBilled = ldBalanceDue != null
    ? Number(claim.invoice!.total)
    : contractAmount
  // contractBalanceDue mirrors the LD invoice when linked; for
  // onboarded claims with no LD invoice yet we treat the entire
  // billed amount as outstanding (no payment audit to subtract).
  const contractBalanceDue = ldBalanceDue ?? contractAmount
  const settledGross = num(claim.amountSettled)
  const deductible   = num(claim.deductibleAmount) ?? 0
  const settledNet   = settledGross == null ? null : Math.max(0, settledGross - deductible)
  const clientExposure = contractBalanceDue == null
    ? null
    : Math.max(0, contractBalanceDue - (settledNet ?? 0))

  return NextResponse.json({
    claim: {
      ...claim,
      repairEstimate: num(claim.repairEstimate),
      repairActual: num(claim.repairActual),
      dailyRevenueRate: num(claim.dailyRevenueRate),
      lossOfRevenue: num(claim.lossOfRevenue),
      totalDemand: num(claim.totalDemand),
      amountOffered: num(claim.amountOffered),
      amountSettled: num(claim.amountSettled),
      lossAmount: num(claim.lossAmount),
      contractAmount: num(claim.contractAmount),
      acvReceived: num(claim.acvReceived),
      depreciationApplied: num(claim.depreciationApplied),
      deductibleAmount: num(claim.deductibleAmount),
      adminFeeAmount: num(claim.adminFeeAmount),
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
        estimatedRepairCost: num(d.estimatedRepairCost),
      })),
      timeline: claim.timeline.map((t) => ({
        ...t,
        amount: num(t.amount),
      })),
      // Server-computed ledger view — clients don't redo the math,
      // and the formula stays in one place.
      ledger: {
        contractBilled,
        contractPaid:       ldBalanceDue != null ? Number(claim.invoice!.amountPaid) : null,
        contractBalanceDue,
        // True when the contract side comes from the rep-captured
        // claim.contractAmount rather than an LD invoice. UI uses this
        // to render an "Estimated — no LD invoice yet" caveat next to
        // the contract column.
        contractFromOnboardingField: ldBalanceDue == null && contractAmount != null,
        insuranceSettledGross: settledGross,
        insuranceSettledNetOfDeductible: settledNet,
        deductibleApplied:  deductible || null,
        clientExposure,
      },
      // Phase A — server-computed badges (same shape as the list).
      badges: computeClaimBadgeFacts({
        status: claim.status,
        nextActionAt: claim.nextActionAt,
        lastContactAt: claim.lastContactAt,
        clientExposure,
        coiCheckId: claim.coiCheckId,
        invoice: claim.invoice
          ? {
              type: claim.invoice.type,
              dueDate: claim.invoice.dueDate,
              balanceDue: Number(claim.invoice.balanceDue),
            }
          : null,
        statusUpdatedAt: claim.updatedAt,
        fromEmailDraft: !!claim.onboardedFromEmailMessageId,
      }).badges,
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
  carrierClaimNumber?: unknown
  repairEstimate?: unknown
  repairActual?: unknown
  repairVendor?: unknown
  daysOutOfService?: unknown
  dailyRevenueRate?: unknown
  lossOfRevenue?: unknown
  totalDemand?: unknown
  amountOffered?: unknown
  amountSettled?: unknown
  // Phase A ledger fields
  lossAmount?: unknown
  contractAmount?: unknown
  acvReceived?: unknown
  depreciationApplied?: unknown
  deductibleAmount?: unknown
  adminFeeAmount?: unknown
  // Phase A follow-up cadence
  nextActionAt?: unknown      // ISO date string or null
  lastContactAt?: unknown     // ISO date string or null
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
  const carrierClaimNumber = asString(body.carrierClaimNumber, 100)
  if (carrierClaimNumber !== undefined) data.carrierClaimNumber = carrierClaimNumber
  const repairVendor = asString(body.repairVendor, 200)
  if (repairVendor !== undefined) data.repairVendor = repairVendor
  const notes = asString(body.notes, 20_000)
  if (notes !== undefined) data.notes = notes

  // Phase A ledger money — same Decimal handling as the existing
  // money fields. No timeline event on these; the rep can log a
  // note manually via /timeline if they want context.
  const lossAmount = asDecimal(body.lossAmount)
  if (lossAmount !== undefined) data.lossAmount = lossAmount
  const contractAmount = asDecimal(body.contractAmount)
  if (contractAmount !== undefined) data.contractAmount = contractAmount
  const acvReceived = asDecimal(body.acvReceived)
  if (acvReceived !== undefined) data.acvReceived = acvReceived
  const depreciationApplied = asDecimal(body.depreciationApplied)
  if (depreciationApplied !== undefined) data.depreciationApplied = depreciationApplied
  const deductibleAmount = asDecimal(body.deductibleAmount)
  if (deductibleAmount !== undefined) data.deductibleAmount = deductibleAmount
  const adminFeeAmount = asDecimal(body.adminFeeAmount)
  if (adminFeeAmount !== undefined) data.adminFeeAmount = adminFeeAmount

  // Phase A follow-up timestamps. Stored as DateTime; the wire
  // value is an ISO string ("2026-06-10" or full timestamp).
  // Empty/null clears.
  const parseDate = (v: unknown): Date | null | undefined => {
    if (v === undefined) return undefined
    if (v === null || v === '') return null
    if (typeof v !== 'string') return undefined
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? undefined : d
  }
  const nextActionAt = parseDate(body.nextActionAt)
  if (nextActionAt !== undefined) data.nextActionAt = nextActionAt
  const lastContactAt = parseDate(body.lastContactAt)
  if (lastContactAt !== undefined) data.lastContactAt = lastContactAt

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
