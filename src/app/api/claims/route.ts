/**
 * GET  /api/claims         — list with status filter
 * POST /api/claims         — manual create (onboarding path for
 *                            historical claims that didn't come
 *                            through the openLdClaim() LD-invoice
 *                            flow)
 *
 * The existing openLdClaim() helper at src/lib/claims/openLdClaim.ts
 * remains the canonical create path when an LD invoice exists.
 * THIS POST endpoint is the bypass used by /claims for onboarding —
 * it doesn't require an invoice, but it DOES still require booking
 * + asset + company (the schema's required FKs) so the rep has to
 * resolve those upstream. The claim is created in DRAFT and the
 * caller can then PATCH it through the lifecycle.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { nextClaimNumber } from '@/lib/orders'
import { computeClaimBadgeFacts } from '@/lib/claims/claimBadges'
import type { ClaimStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

const CLAIM_STATUSES: ClaimStatus[] = [
  'DRAFT', 'READY_TO_SEND', 'SUBMITTED', 'ACKNOWLEDGED', 'NEGOTIATING',
  'SETTLED', 'DENIED', 'ESCALATED', 'CLOSED',
]
function isClaimStatus(v: unknown): v is ClaimStatus {
  return typeof v === 'string' && CLAIM_STATUSES.includes(v as ClaimStatus)
}

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const sp = new URL(req.url).searchParams
  const statusParam = sp.get('status')
  const open = sp.get('open') === '1'

  const where: Record<string, unknown> = {}
  if (statusParam && isClaimStatus(statusParam)) {
    where.status = statusParam
  } else if (open) {
    // "Open" = anything that isn't a terminal state. Used by the
    // default list view so we don't drown the screen in settled
    // history.
    where.status = { notIn: ['SETTLED', 'CLOSED', 'DENIED'] }
  }

  const claims = await prisma.insuranceClaim.findMany({
    where,
    select: {
      id: true,
      claimNumber: true,
      status: true,
      filedAgainst: true,
      adjusterName: true,
      adjusterEmail: true,
      policyNumber: true,
      carrierClaimNumber: true,
      incidentDate: true,
      incidentDescription: true,
      repairEstimate: true,
      repairActual: true,
      totalDemand: true,
      amountOffered: true,
      amountSettled: true,
      deductibleAmount: true,
      contractAmount: true,
      coiCheckId: true,
      nextActionAt: true,
      lastContactAt: true,
      submittedAt: true,
      settledAt: true,
      createdAt: true,
      updatedAt: true,
      company: { select: { id: true, name: true } },
      asset: {
        select: {
          id: true, unitName: true, year: true, make: true, model: true,
          category: { select: { name: true } },
        },
      },
      assignedToUser: { select: { id: true, name: true } },
      invoice: {
        select: {
          id: true, invoiceNumber: true, type: true,
          total: true, balanceDue: true, dueDate: true,
        },
      },
      _count: { select: { timeline: true, documents: true, damageItems: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })

  const now = new Date()
  const enriched = claims.map((c) => {
    // Same client-exposure formula as GET /api/claims/[id]. Kept
    // inline here (rather than a shared helper) because the list
    // doesn't pull invoice.amountPaid — we only need balanceDue for
    // the math, and importing a 3-line formula isn't worth the
    // extra abstraction yet.
    const ldBalanceDue = c.invoice && c.invoice.type === 'LD' ? Number(c.invoice.balanceDue) : null
    // Onboarded-claim fallback — when no LD invoice exists, use the
    // rep-captured contractAmount as the contract-side anchor. Same
    // semantics as GET /api/claims/[id]'s ledger composition.
    const contractAmount = c.contractAmount == null ? null : Number(c.contractAmount)
    const contractBalanceDue = ldBalanceDue ?? contractAmount
    const settledGross = c.amountSettled == null ? null : Number(c.amountSettled)
    const deductible = c.deductibleAmount == null ? 0 : Number(c.deductibleAmount)
    const settledNet = settledGross == null ? null : Math.max(0, settledGross - deductible)
    const clientExposure = contractBalanceDue == null ? null : Math.max(0, contractBalanceDue - (settledNet ?? 0))

    const facts = computeClaimBadgeFacts(
      {
        status: c.status,
        nextActionAt: c.nextActionAt,
        lastContactAt: c.lastContactAt,
        clientExposure,
        coiCheckId: c.coiCheckId,
        invoice: c.invoice
          ? {
              type: c.invoice.type,
              dueDate: c.invoice.dueDate,
              balanceDue: Number(c.invoice.balanceDue),
            }
          : null,
        statusUpdatedAt: c.updatedAt,
      },
      now,
    )

    return {
      ...c,
      repairEstimate: c.repairEstimate == null ? null : Number(c.repairEstimate),
      repairActual: c.repairActual == null ? null : Number(c.repairActual),
      totalDemand: c.totalDemand == null ? null : Number(c.totalDemand),
      amountOffered: c.amountOffered == null ? null : Number(c.amountOffered),
      amountSettled: c.amountSettled == null ? null : Number(c.amountSettled),
      invoice: c.invoice
        ? { ...c.invoice, total: Number(c.invoice.total), balanceDue: Number(c.invoice.balanceDue) }
        : null,
      clientExposure,
      badges: facts.badges,
      severity: facts.severity,
    }
  })

  // Sort by severity desc, then updatedAt desc. Attention-needing
  // claims always sit at the top regardless of the active filter.
  enriched.sort((a, b) => {
    if (a.severity !== b.severity) return b.severity - a.severity
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  return NextResponse.json({ claims: enriched })
}

interface CreateBody {
  companyId?: unknown
  assetId?: unknown
  bookingId?: unknown
  invoiceId?: unknown // optional — if provided, must be an LD invoice
  coiCheckId?: unknown
  filedAgainst?: unknown
  incidentDate?: unknown // 'YYYY-MM-DD'
  incidentDescription?: unknown
  // Carrier-side identifiers
  adjusterName?: unknown
  adjusterPhone?: unknown
  adjusterEmail?: unknown
  policyNumber?: unknown
  carrierClaimNumber?: unknown
  // One-step onboarding snapshot — the full set the rep typically has
  // when loading a historical / in-flight claim. All optional; the
  // create endpoint accepts the snapshot in one POST so Ana doesn't
  // have to create-then-PATCH across the backlog.
  status?: unknown // ClaimStatus — defaults DRAFT when omitted
  nextActionAt?: unknown // ISO date string
  lossAmount?: unknown
  contractAmount?: unknown
  acvReceived?: unknown
  depreciationApplied?: unknown
  deductibleAmount?: unknown
  adminFeeAmount?: unknown
  totalDemand?: unknown
  amountOffered?: unknown
  amountSettled?: unknown
  assignedTo?: unknown
  notes?: unknown
}

// Number-or-null coercion for the optional money fields. Empty
// string + null both clear; anything non-numeric is dropped (treated
// as undefined so it doesn't blank an existing value).
function asMoney(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  return n
}

function asString(v: unknown, max = 500): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length === 0 ? null : t.length > max ? t.slice(0, max) : t
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

  const companyId = asString(body.companyId, 100)
  // Phase A — bookingId/assetId are NULLABLE now so historical claims
  // can be onboarded without an HQ booking/asset record. When supplied,
  // we still verify they exist; when omitted, we proceed with null.
  const assetId = asString(body.assetId, 100)
  const bookingId = asString(body.bookingId, 100)
  const filedAgainst = asString(body.filedAgainst, 200)
  const incidentDescription = asString(body.incidentDescription, 10_000)
  const incidentDateStr = asString(body.incidentDate, 10)
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 })
  if (!filedAgainst) return NextResponse.json({ error: 'filedAgainst required (carrier name)' }, { status: 400 })
  if (!incidentDescription || incidentDescription.length < 10) {
    return NextResponse.json({ error: 'incidentDescription required (≥10 chars)' }, { status: 400 })
  }
  if (!incidentDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(incidentDateStr)) {
    return NextResponse.json({ error: 'incidentDate required (YYYY-MM-DD)' }, { status: 400 })
  }
  const incidentDate = new Date(`${incidentDateStr}T00:00:00.000Z`)

  // Confirm company always; asset / booking only when supplied.
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  })
  if (!company) return NextResponse.json({ error: 'company not found' }, { status: 404 })
  if (assetId) {
    const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true } })
    if (!asset) return NextResponse.json({ error: 'asset not found' }, { status: 404 })
  }
  if (bookingId) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true } })
    if (!booking) return NextResponse.json({ error: 'booking not found' }, { status: 404 })
  }

  const invoiceId = asString(body.invoiceId, 100)
  if (invoiceId) {
    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { type: true, insuranceClaims: { select: { id: true } } },
    })
    if (!inv) return NextResponse.json({ error: 'invoice not found' }, { status: 404 })
    if (inv.type !== 'LD') {
      return NextResponse.json({ error: 'invoice must be type LD' }, { status: 409 })
    }
    if (inv.insuranceClaims.length > 0) {
      return NextResponse.json({ error: 'invoice already has a claim attached' }, { status: 409 })
    }
  }

  // Status — defaults DRAFT when omitted. Auto-stamps submittedAt /
  // settledAt the same way PATCH does when the claim opens directly
  // into a later lifecycle state (the historical onboarding case:
  // we know the claim was submitted last March, no point parking
  // it in DRAFT first).
  const CLAIM_STATUSES = ['DRAFT','READY_TO_SEND','SUBMITTED','ACKNOWLEDGED','NEGOTIATING','SETTLED','DENIED','ESCALATED','CLOSED'] as const
  type ClaimStatusLit = (typeof CLAIM_STATUSES)[number]
  const statusInRaw = asString(body.status, 30)
  const statusIn: ClaimStatusLit =
    statusInRaw && (CLAIM_STATUSES as readonly string[]).includes(statusInRaw)
      ? (statusInRaw as ClaimStatusLit)
      : 'DRAFT'
  const now = new Date()
  const submittedAt = statusIn === 'SUBMITTED' || statusIn === 'ACKNOWLEDGED' || statusIn === 'NEGOTIATING' || statusIn === 'SETTLED' || statusIn === 'DENIED' || statusIn === 'CLOSED' || statusIn === 'ESCALATED'
    ? now
    : null
  const settledAt = statusIn === 'SETTLED' ? now : null

  // Money snapshot. All optional; null clears (rep can explicitly
  // unset). The endpoint's same Decimal handling as the PATCH path.
  const moneyFields = {
    lossAmount: asMoney(body.lossAmount),
    contractAmount: asMoney(body.contractAmount),
    acvReceived: asMoney(body.acvReceived),
    depreciationApplied: asMoney(body.depreciationApplied),
    deductibleAmount: asMoney(body.deductibleAmount),
    adminFeeAmount: asMoney(body.adminFeeAmount),
    totalDemand: asMoney(body.totalDemand),
    amountOffered: asMoney(body.amountOffered),
    amountSettled: asMoney(body.amountSettled),
  }

  // nextActionAt — optional ISO date.
  const nextActionAtRaw = asString(body.nextActionAt, 30)
  const nextActionAt = nextActionAtRaw ? new Date(nextActionAtRaw) : null
  if (nextActionAtRaw && Number.isNaN(nextActionAt!.getTime())) {
    return NextResponse.json({ error: 'nextActionAt must be a valid date' }, { status: 400 })
  }

  const claimNumber = await nextClaimNumber()
  const claim = await prisma.$transaction(async (tx) => {
    const created = await tx.insuranceClaim.create({
      data: {
        claimNumber,
        bookingId,
        assetId,
        companyId,
        invoiceId: invoiceId ?? null,
        coiCheckId: asString(body.coiCheckId, 100),
        status: statusIn,
        submittedAt,
        settledAt,
        filedAgainst,
        adjusterName: asString(body.adjusterName, 200),
        adjusterPhone: asString(body.adjusterPhone, 50),
        adjusterEmail: asString(body.adjusterEmail, 200),
        policyNumber: asString(body.policyNumber, 100),
        carrierClaimNumber: asString(body.carrierClaimNumber, 100),
        assignedTo: asString(body.assignedTo, 100),
        notes: asString(body.notes, 10_000),
        incidentDate,
        incidentDescription,
        nextActionAt,
        // Money snapshot — only set the fields the caller supplied.
        ...(moneyFields.lossAmount         !== undefined && { lossAmount:         moneyFields.lossAmount }),
        ...(moneyFields.contractAmount     !== undefined && { contractAmount:     moneyFields.contractAmount }),
        ...(moneyFields.acvReceived        !== undefined && { acvReceived:        moneyFields.acvReceived }),
        ...(moneyFields.depreciationApplied!== undefined && { depreciationApplied:moneyFields.depreciationApplied }),
        ...(moneyFields.deductibleAmount   !== undefined && { deductibleAmount:   moneyFields.deductibleAmount }),
        ...(moneyFields.adminFeeAmount     !== undefined && { adminFeeAmount:     moneyFields.adminFeeAmount }),
        ...(moneyFields.totalDemand        !== undefined && { totalDemand:        moneyFields.totalDemand }),
        ...(moneyFields.amountOffered      !== undefined && { amountOffered:      moneyFields.amountOffered }),
        ...(moneyFields.amountSettled      !== undefined && { amountSettled:      moneyFields.amountSettled }),
      },
      select: { id: true, claimNumber: true },
    })
    await tx.claimTimeline.create({
      data: {
        claimId: created.id,
        action: 'CREATED',
        description: statusIn === 'DRAFT'
          ? `Manual onboarding — filed against ${filedAgainst}.`
          : `Onboarded into ${statusIn} — filed against ${filedAgainst}.`,
        performedBy: me.id,
      },
    })
    await tx.auditLog.create({
      data: {
        userId: me.id,
        action: 'claim.opened',
        entityType: 'InsuranceClaim',
        entityId: created.id,
        newValues: {
          claimNumber: created.claimNumber,
          filedAgainst,
          status: statusIn,
          onboarded: true,
        },
      },
    })
    return created
  })

  return NextResponse.json(
    { ok: true, claim: { id: claim.id, claimNumber: claim.claimNumber } },
    { status: 201 },
  )
}
