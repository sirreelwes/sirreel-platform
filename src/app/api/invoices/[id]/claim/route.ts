/**
 * POST /api/invoices/[id]/claim   — open an InsuranceClaim against
 *                                    this LD invoice.
 * GET  /api/invoices/[id]/claim   — read the claim attached (if any).
 *
 * Phase 5 commit 4. Body:
 *   { filedAgainst, incidentDate: 'YYYY-MM-DD', incidentDescription,
 *     adjusterName?, adjusterPhone?, adjusterEmail?, policyNumber?,
 *     coiCheckId? }
 *
 * Claims are non-blocking on Order.status. Pipeline lives on the
 * existing /claims surface; this endpoint creates the row + opening
 * timeline entry.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { openLdClaim } from '@/lib/claims/openLdClaim'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    filedAgainst?: unknown
    incidentDate?: unknown
    incidentDescription?: unknown
    adjusterName?: unknown
    adjusterPhone?: unknown
    adjusterEmail?: unknown
    policyNumber?: unknown
    coiCheckId?: unknown
  }
  const filedAgainst =
    typeof body.filedAgainst === 'string' && body.filedAgainst.trim().length > 0
      ? body.filedAgainst.trim().slice(0, 200)
      : null
  if (!filedAgainst) {
    return NextResponse.json({ error: 'filedAgainst required (insurance company name)' }, { status: 400 })
  }
  const incidentDate =
    typeof body.incidentDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.incidentDate)
      ? new Date(`${body.incidentDate}T00:00:00.000Z`)
      : null
  if (!incidentDate) {
    return NextResponse.json({ error: 'incidentDate required (YYYY-MM-DD)' }, { status: 400 })
  }
  const incidentDescription =
    typeof body.incidentDescription === 'string' && body.incidentDescription.trim().length >= 10
      ? body.incidentDescription.trim().slice(0, 10_000)
      : null
  if (!incidentDescription) {
    return NextResponse.json(
      { error: 'incidentDescription required (≥10 chars)' },
      { status: 400 },
    )
  }
  const coiCheckId =
    body.coiCheckId === null
      ? null
      : typeof body.coiCheckId === 'string'
        ? body.coiCheckId
        : undefined
  const adjusterName = typeof body.adjusterName === 'string' ? body.adjusterName.trim().slice(0, 200) || null : null
  const adjusterPhone = typeof body.adjusterPhone === 'string' ? body.adjusterPhone.trim().slice(0, 50) || null : null
  const adjusterEmail = typeof body.adjusterEmail === 'string' ? body.adjusterEmail.trim().slice(0, 200) || null : null
  const policyNumber = typeof body.policyNumber === 'string' ? body.policyNumber.trim().slice(0, 100) || null : null

  const result = await openLdClaim({
    invoiceId: params.id,
    filedAgainst,
    incidentDate,
    incidentDescription,
    adjusterName,
    adjusterPhone,
    adjusterEmail,
    policyNumber,
    coiCheckId,
    recordedById: user.id,
  })
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
  }
  return NextResponse.json(result, { status: 201 })
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      insuranceClaims: {
        select: {
          id: true,
          claimNumber: true,
          status: true,
          filedAgainst: true,
          incidentDate: true,
          incidentDescription: true,
          totalDemand: true,
          amountSettled: true,
          assignedToUser: { select: { id: true, name: true } },
          coiCheck: { select: { id: true } },
          createdAt: true,
        },
      },
    },
  })
  if (!invoice) return NextResponse.json({ error: 'invoice not found' }, { status: 404 })
  return NextResponse.json({ claim: invoice.insuranceClaims[0] ?? null })
}
