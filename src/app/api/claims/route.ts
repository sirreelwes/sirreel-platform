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
      incidentDate: true,
      incidentDescription: true,
      repairEstimate: true,
      repairActual: true,
      totalDemand: true,
      amountOffered: true,
      amountSettled: true,
      deductibleAmount: true,
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
    const settledGross = c.amountSettled == null ? null : Number(c.amountSettled)
    const deductible = c.deductibleAmount == null ? 0 : Number(c.deductibleAmount)
    const settledNet = settledGross == null ? null : Math.max(0, settledGross - deductible)
    const clientExposure = ldBalanceDue == null ? null : Math.max(0, ldBalanceDue - (settledNet ?? 0))

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
  adjusterName?: unknown
  adjusterPhone?: unknown
  adjusterEmail?: unknown
  policyNumber?: unknown
  assignedTo?: unknown
  notes?: unknown
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
        status: 'DRAFT',
        filedAgainst,
        adjusterName: asString(body.adjusterName, 200),
        adjusterPhone: asString(body.adjusterPhone, 50),
        adjusterEmail: asString(body.adjusterEmail, 200),
        policyNumber: asString(body.policyNumber, 100),
        assignedTo: asString(body.assignedTo, 100),
        notes: asString(body.notes, 10_000),
        incidentDate,
        incidentDescription,
      },
      select: { id: true, claimNumber: true },
    })
    await tx.claimTimeline.create({
      data: {
        claimId: created.id,
        action: 'CREATED',
        description: `Manual onboarding — filed against ${filedAgainst}.`,
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
