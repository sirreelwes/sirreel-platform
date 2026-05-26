/**
 * POST /api/jobs/[id]/follow-ups/send — job-scoped thin wrapper.
 *
 * Resolves the Job's most-recently-sent QUOTE_SENT Order, then internally
 * forwards to the per-order POST /api/orders/[orderId]/follow-ups/send so
 * dispatch, recipient ranking, state writes, and gating logic stay in
 * one place.
 *
 * Used by the pipeline /sales/pipeline Kanban's ad-hoc Nudge button —
 * the Kanban groups by Job and doesn't carry an Order id, so this
 * wrapper does the Job → Order resolution server-side rather than
 * widening the /api/jobs payload or forcing a client round-trip.
 *
 * Body (optional): { message?: string }  — relayed straight through.
 * stage is always omitted; the per-order endpoint auto-resolves it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { resolveJobLatestSentOrder } from '@/lib/sales/resolveJobLatestSentOrder'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return bad(401, 'unauthorized')

  const body = await req.json().catch(() => ({}))
  const message = typeof body?.message === 'string' ? body.message : undefined
  const dryRun = body?.dryRun === true

  const order = await resolveJobLatestSentOrder(params.id)
  if (!order) {
    return bad(409, 'no SENT order on this job — nothing to follow up on')
  }

  // Forward to the per-order endpoint. Reusing the route handler over
  // an HTTP call would mean hopping through fetch + cookies; instead
  // we re-dispatch by reconstructing a Request and calling the
  // exported POST directly so cookies/session propagate naturally.
  const { POST: orderPost } = await import('@/app/api/orders/[id]/follow-ups/send/route')
  const forwardPayload: { message?: string; dryRun?: boolean } = {}
  if (message) forwardPayload.message = message
  if (dryRun) forwardPayload.dryRun = true
  const forwarded = new NextRequest(
    new URL(`/api/orders/${order.id}/follow-ups/send`, req.url),
    {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify(forwardPayload),
    },
  )
  return orderPost(forwarded, { params: { id: order.id } })
}
