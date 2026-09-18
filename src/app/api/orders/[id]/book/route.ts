/**
 * POST /api/orders/[id]/book
 *
 * Phase 1 / commit 3 — the "Book it" transition. Atomically flips an
 * APPROVED order to BOOKED, snapshots the booked-value money fields,
 * routes line items by department, writes an audit log entry, and
 * (post-transaction) projects the cadence state forward.
 *
 * Auth: dashboard session required. ipAddress is captured for the
 * audit log; null when missing.
 *
 * All the actual logic lives in src/lib/orders/bookOrder.ts so the
 * helper can be invoked from other contexts (CLI ops scripts, future
 * batch-book flows) without going through HTTP.
 *
 * Returns:
 *   200 { ok: true, orderId, bookedAt, bookedTotal, laneCounts }
 *   401 { error: 'unauthorized' }
 *   404 { error: 'order not found' }
 *   409 { error: '...', currentStatus }   — bad source state
 *   409 { error: 'unsigned partner', requiresConfirmation, partners[] }
 *        — a partner on the order has nothing signed; re-POST with
 *          confirmUnsignedPartner: true to book anyway (Wes 2026-09-18)
 *   500 { error: '...' }                   — transaction failure
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { bookOrder } from '@/lib/orders/bookOrder'
import { partnerPaperGate } from '@/lib/sub-rentals/partnerPaperGate'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // An UNSIGNED partner on the order (Wes 2026-09-18). This is the OTHER
  // door to BOOKED — the order page's APPROVED action — and a gate on
  // mark-booked alone would be bypassed by one button. Confirmable for the
  // same reason: the rep cannot produce the partner's countersignature.
  const body = (await req.json().catch(() => ({}))) as { confirmUnsignedPartner?: boolean } | null
  if (!body?.confirmUnsignedPartner) {
    const paper = await partnerPaperGate(params.id)
    if (!paper.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: 'unsigned partner',
          reason: paper.message,
          requiresConfirmation: 'confirmUnsignedPartner',
          partners: paper.unsigned.map((p) => ({ name: p.vendorName, units: p.unitNames, status: p.status })),
        },
        { status: 409 },
      )
    }
  }

  // Resolve userId from the session email so the audit log gets a real
  // FK. Failure here doesn't block the book — userId is nullable on
  // AuditLog.
  let userId: string | null = null
  try {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    })
    userId = user?.id ?? null
  } catch {
    /* non-fatal */
  }

  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null

  const result = await bookOrder({ orderId: params.id, userId, ipAddress })

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, currentStatus: result.currentStatus },
      { status: result.status },
    )
  }

  return NextResponse.json(result)
}
