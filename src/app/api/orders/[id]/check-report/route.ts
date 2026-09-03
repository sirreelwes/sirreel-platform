/**
 * /api/orders/[id]/check-report — file (or correct) the paper pull sheet.
 *
 *   GET  ?edge=OUT|IN  → the draft: the order's lines with actuals
 *                        pre-filled, plus anything a prior report said
 *   POST               → submit; on the OUT edge this also writes the
 *                        differences onto the order, flags the agent, and
 *                        re-sends the corrected quote to the client when
 *                        the order is still in quote form
 *   PATCH              → the agent acknowledging what changed
 *
 * Gates. Filing is YARD work (requireYardAccess — the fleet-or-warehouse
 * door, which is ADMIN/MANAGER/FLEET_TECH/WAREHOUSE), because the people
 * Hugo named are supervisors on that side. Acknowledging is the SALES
 * side of the same conversation, so it takes any signed-in staff session
 * that can see orders — the agent, or whoever is covering for them.
 *
 * This is deliberately the only route through which the yard may change
 * an order: creating one is sales-only (requireOrderCreateAccess), and
 * general order edits go through /api/orders/[id].
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { OrderCheckEdge } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireYardAccess } from '@/lib/yard/requireYardAccess'
import { reportDraft, submitCheckReport, type SubmitLineInput } from '@/lib/orders/checkReports'
import { resendQuoteAfterCheckOut, type ResendOutcome } from '@/lib/orders/resendQuoteOnChange'

export const dynamic = 'force-dynamic'
// A submit that changes a quote re-renders the PDF and dispatches an
// email. Same 30s ceiling the other send routes use.
export const maxDuration = 30

function parseEdge(raw: string | null): OrderCheckEdge | null {
  return raw === 'OUT' || raw === 'IN' ? raw : null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireYardAccess()
  if (!auth.ok) return auth.response
  const { id } = await params
  const edge = parseEdge(new URL(req.url).searchParams.get('edge'))
  if (!edge) return NextResponse.json({ error: 'edge must be OUT or IN' }, { status: 400 })

  const draft = await reportDraft(id, edge)
  if (!draft) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  return NextResponse.json({ draft })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireYardAccess()
  if (!auth.ok) return auth.response
  const { id } = await params

  const body = (await req.json().catch(() => null)) as {
    edge?: string
    preppedBy?: string
    notes?: string
    lines?: unknown
  } | null
  const edge = parseEdge(body?.edge ?? null)
  if (!edge) return NextResponse.json({ error: 'edge must be OUT or IN' }, { status: 400 })
  if (!Array.isArray(body?.lines)) {
    return NextResponse.json({ error: 'lines[] required' }, { status: 400 })
  }

  // Trust the client for the COUNT and the note, never for the expected
  // quantity or the identity of the line — those come off the order, so
  // a stale form cannot rewrite history by claiming a different baseline.
  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, lineItems: { select: { id: true, description: true, quantity: true } } },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  const byId = new Map(order.lineItems.map((l) => [l.id, l]))

  const lines: SubmitLineInput[] = []
  for (const raw of body.lines as Array<Record<string, unknown>>) {
    const lineId = typeof raw.orderLineItemId === 'string' ? raw.orderLineItemId : null
    const actual = Number(raw.actualQty)
    if (!Number.isInteger(actual) || actual < 0) {
      return NextResponse.json({ error: 'every actualQty must be a non-negative whole number' }, { status: 400 })
    }
    const description = typeof raw.description === 'string' ? raw.description.trim() : ''
    if (lineId) {
      const li = byId.get(lineId)
      if (!li) return NextResponse.json({ error: `line ${lineId} is not on this order` }, { status: 400 })
      lines.push({
        orderLineItemId: li.id,
        description: description || li.description,
        expectedQty: li.quantity,
        actualQty: actual,
        substituteFor: typeof raw.substituteFor === 'string' ? raw.substituteFor : null,
        note: typeof raw.note === 'string' ? raw.note : null,
      })
    } else {
      // An ADDED row — something on the truck that was never on the
      // order. Recorded, and flagged to the agent to price; NOT added as
      // an order line here, because the yard cannot see rates and a line
      // at $0 would quietly under-bill the job.
      if (!description) continue
      lines.push({
        orderLineItemId: null,
        description,
        expectedQty: 0,
        actualQty: actual,
        substituteFor: null,
        note: typeof raw.note === 'string' ? raw.note : null,
      })
    }
  }

  const result = await submitCheckReport({
    orderId: id,
    edge,
    submittedById: auth.userId,
    preppedBy: typeof body.preppedBy === 'string' && body.preppedBy.trim() ? body.preppedBy.trim() : null,
    notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
    lines,
  })

  // Wes, 2026-09-03: "re-send the quote automatically when the check-out
  // changes it but copy hq notifications." The order's lines have just
  // moved under a client who is usually still holding a quote, so the
  // corrected document goes out on its own rather than waiting for the
  // agent to notice the flag.
  //
  // Deliberately AFTER the report is filed and deliberately non-fatal:
  // the sheet is the yard's work and must not depend on Resend, a blob
  // fetch or a PDF render. The outcome comes back so the screen can say
  // what happened instead of leaving the supervisor guessing.
  let resend: ResendOutcome | null = null
  if (edge === 'OUT' && result.changedOrder) {
    try {
      resend = await resendQuoteAfterCheckOut({ orderId: id, changes: result.changes })
    } catch (err) {
      console.error('[check-report] quote re-send failed:', err)
      resend = { sent: false, reason: err instanceof Error ? err.message : 'the re-send failed' }
    }
  }

  return NextResponse.json({ ok: true, ...result, resend })
}

/** The agent marking "I've seen what the yard changed." */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { id } = await params
  const edge = parseEdge(new URL(req.url).searchParams.get('edge'))
  if (!edge) return NextResponse.json({ error: 'edge must be OUT or IN' }, { status: 400 })

  const report = await prisma.orderCheckReport.findUnique({
    where: { orderId_edge: { orderId: id, edge } },
    select: { id: true },
  })
  if (!report) return NextResponse.json({ error: 'no report filed' }, { status: 404 })

  await prisma.orderCheckReport.update({
    where: { id: report.id },
    data: { agentAckedAt: new Date(), agentAckedById: user.id },
  })
  return NextResponse.json({ ok: true })
}
