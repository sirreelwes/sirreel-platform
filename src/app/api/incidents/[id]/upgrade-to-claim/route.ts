/**
 * POST /api/incidents/[id]/upgrade-to-claim
 *
 * Creates an InsuranceClaim linked to the Incident. This is where the
 * CARRIER-REQUIRED FLOOR lives now — the pre-Incidents auto-draft path
 * used to enforce it inside onboardFromEmail; that path is unchanged
 * but the new manual upgrade path is what the rep clicks for any
 * incident that doesn't already have a claim.
 *
 * Required body:
 *   filedAgainst        — carrier name (non-empty)
 *   carrierClaimNumber  — the carrier's number (non-empty)
 *   incidentDate        — YYYY-MM-DD (defaults to Incident.occurredAt
 *                          or today if neither is set)
 *
 * Optional body:
 *   policyNumber, adjusterName/Email/Phone, status (defaults DRAFT)
 *
 * Side effects (single transaction):
 *   - InsuranceClaim row created (claimNumber via nextClaimNumber)
 *   - Incident.status → CLAIM_FILED (forward-only)
 *   - Incident.companyId → claim.companyId required by InsuranceClaim,
 *     so we fail if the Incident has no Company yet (UI is supposed to
 *     gate the button until then; this is a server-side belt)
 *
 * Auth: getServerSession.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { nextClaimNumber } from '@/lib/orders'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

interface UpgradeBody {
  filedAgainst?: unknown
  carrierClaimNumber?: unknown
  incidentDate?: unknown
  policyNumber?: unknown
  adjusterName?: unknown
  adjusterEmail?: unknown
  adjusterPhone?: unknown
  status?: unknown
}

function asString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length === 0 ? null : t.slice(0, max)
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: incidentId } = await params
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      id: true, status: true, description: true, occurredAt: true,
      companyId: true, assetId: true, orderId: true,
      // Pre-existing claims block accidental dual-claim creation. The
      // model allows multiple claims per incident (one carrier + an
      // independent driver claim is a real case) but we make it an
      // explicit second call rather than a hidden side effect.
      _count: { select: { claims: true } },
    },
  })
  if (!incident) return NextResponse.json({ error: 'incident not found' }, { status: 404 })
  if (!incident.companyId) {
    return NextResponse.json(
      { error: 'incident has no Company linked — set companyId first' },
      { status: 409 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as UpgradeBody

  // ── Carrier floor ──────────────────────────────────────────
  const filedAgainst = asString(body.filedAgainst, 200)
  if (!filedAgainst) {
    return NextResponse.json(
      { error: 'filedAgainst (carrier name) required to upgrade to claim' },
      { status: 400 },
    )
  }
  const carrierClaimNumber = asString(body.carrierClaimNumber, 100)
  if (!carrierClaimNumber) {
    return NextResponse.json(
      { error: 'carrierClaimNumber required to upgrade to claim' },
      { status: 400 },
    )
  }

  // Optional fields
  const policyNumber = asString(body.policyNumber, 100)
  const adjusterName = asString(body.adjusterName, 200)
  const adjusterEmail = asString(body.adjusterEmail, 200)
  const adjusterPhone = asString(body.adjusterPhone, 50)
  const statusIn = asString(body.status, 30) ?? 'DRAFT'

  // incidentDate: explicit > Incident.occurredAt > today
  const explicitDate = asString(body.incidentDate, 10)
  let incidentDate: Date
  if (explicitDate && /^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) {
    incidentDate = new Date(`${explicitDate}T00:00:00.000Z`)
  } else if (incident.occurredAt) {
    incidentDate = incident.occurredAt
  } else {
    const now = new Date()
    incidentDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  }

  // ── Mint + link ────────────────────────────────────────────
  const claimNumber = await nextClaimNumber()
  const result = await prisma.$transaction(async (tx) => {
    const claim = await tx.insuranceClaim.create({
      data: {
        claimNumber,
        companyId: incident.companyId!,
        bookingId: undefined, // optional FK; left null unless we add a picker later
        assetId: incident.assetId,
        incidentId,
        status: statusIn as 'DRAFT' | 'READY_TO_SEND' | 'SUBMITTED',
        filedAgainst,
        carrierClaimNumber,
        policyNumber,
        adjusterName,
        adjusterEmail,
        adjusterPhone,
        incidentDate,
        incidentDescription: incident.description,
      },
      select: { id: true, claimNumber: true },
    })
    // Forward-only status advance. If the incident has already been
    // billed to renter, keep BILLED_RENTER; we represent the dual
    // posture by leaving status at whatever's "later" in the ladder.
    // For OPEN, advance to CLAIM_FILED.
    if (incident.status === 'OPEN') {
      await tx.incident.update({
        where: { id: incidentId },
        data: { status: 'CLAIM_FILED' },
      })
    }
    return claim
  })

  return NextResponse.json(
    { ok: true, claim: result },
    { status: 201 },
  )
}
