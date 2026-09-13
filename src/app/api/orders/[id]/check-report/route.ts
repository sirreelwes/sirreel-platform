/**
 * /api/orders/[id]/check-report — file (or correct) the paper pull sheet.
 *
 *   GET  ?edge=OUT|IN  → the draft: the order's lines with actuals
 *                        pre-filled, plus anything a prior report said
 *   POST               → submit; on the OUT edge this also writes the
 *                        differences onto the order — moved counts, swaps
 *                        (the line becomes the swapped-in piece) and rows
 *                        added at the dock (they become lines; Wes
 *                        2026-09-12) — flags the agent, and re-sends the
 *                        corrected quote to the client when the order is
 *                        still in quote form and nothing added is unpriced
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
import {
  reportDraft, settleGearAfterReport, submitCheckReport,
  type GearSettleResult, type SubmitLineInput,
} from '@/lib/orders/checkReports'
import { dockCatalogItems } from '@/lib/orders/dockLineWrites'
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
    /** From the photo endpoint — the stored image of the paper sheet. */
    sheetPhotoKey?: string
    sheetPhotoUrl?: string
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
    select: {
      id: true,
      lineItems: { select: { id: true, description: true, quantity: true, inventoryItemId: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  const byId = new Map(order.lineItems.map((l) => [l.id, l]))

  // The catalog rows the sheet names — a swap-in or an added row picked
  // from the warehouse catalog. Resolved once, against warehouse gear
  // only (QUANTITY, active); an id that does not resolve is refused
  // rather than silently downgraded to a typed name, because the
  // supervisor picked it precisely so the rate would follow.
  const rawLines = body.lines as Array<Record<string, unknown>>
  const wantedIds = rawLines
    .map((r) => (typeof r.inventoryItemId === 'string' && r.inventoryItemId ? r.inventoryItemId : null))
    .filter((v): v is string => !!v)
  const catalog = await dockCatalogItems(prisma, wantedIds)
  for (const wid of wantedIds) {
    if (!catalog.has(wid)) {
      return NextResponse.json(
        { error: 'unknown catalog item', reason: 'That catalog item is not warehouse gear, or is no longer active — pick it again or type the name.' },
        { status: 400 },
      )
    }
  }

  const lines: SubmitLineInput[] = []
  for (const raw of rawLines) {
    const lineId = typeof raw.orderLineItemId === 'string' ? raw.orderLineItemId : null
    const actual = Number(raw.actualQty)
    if (!Number.isInteger(actual) || actual < 0) {
      return NextResponse.json({ error: 'every actualQty must be a non-negative whole number' }, { status: 400 })
    }
    const description = typeof raw.description === 'string' ? raw.description.trim() : ''
    const inventoryItemId = typeof raw.inventoryItemId === 'string' && raw.inventoryItemId ? raw.inventoryItemId : null
    if (lineId) {
      const li = byId.get(lineId)
      if (!li) return NextResponse.json({ error: `line ${lineId} is not on this order` }, { status: 400 })
      let substituteFor = typeof raw.substituteFor === 'string' ? raw.substituteFor : null
      // A catalog row picked on an existing line IS a swap, whether or
      // not the "what it replaced" box was filled — the order's own name
      // for the line is what it replaced.
      if (inventoryItemId && inventoryItemId !== li.inventoryItemId && !substituteFor?.trim()) {
        substituteFor = li.description
      }
      lines.push({
        orderLineItemId: li.id,
        description: description || li.description,
        expectedQty: li.quantity,
        actualQty: actual,
        substituteFor,
        note: typeof raw.note === 'string' ? raw.note : null,
        inventoryItemId: inventoryItemId && inventoryItemId !== li.inventoryItemId ? inventoryItemId : null,
        current: { description: li.description, inventoryItemId: li.inventoryItemId },
        // Off-sheet = this line was not part of this pull. Absent means
        // on-sheet, so every existing caller keeps filing full counts.
        onSheet: raw.onSheet !== false,
      })
    } else {
      // An ADDED row — something on the truck that was never on the
      // order. On the OUT edge submitCheckReport turns it into a line
      // (priced from the catalog when one was picked, $0 + flagged when
      // typed); on the IN edge it is recorded and flagged, as before.
      if (!description) continue
      lines.push({
        orderLineItemId: null,
        description,
        expectedQty: 0,
        actualQty: actual,
        substituteFor: null,
        note: typeof raw.note === 'string' ? raw.note : null,
        inventoryItemId,
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
    sheetPhotoKey: typeof body.sheetPhotoKey === 'string' ? body.sheetPhotoKey : null,
    sheetPhotoUrl: typeof body.sheetPhotoUrl === 'string' ? body.sheetPhotoUrl : null,
    catalog,
  })

  // The sheet is also the gear lane's status, on BOTH edges. Advancing
  // the pick list here is what lets a paper check-IN close the job out —
  // without it the list sits at DRAFT forever and Job.returnedAt is
  // never stamped, so a job whose gear is physically back reads "Not
  // returned". Outbound it is what puts the order out: lines LOADED,
  // then LOADED_READY, then ON_JOB, so the job reads "On rental"
  // instead of still picking. Same non-fatal treatment as the re-send:
  // the transcription is filed either way. See settleGearAfterReport.
  let gear: GearSettleResult | null = null
  try {
    gear = await settleGearAfterReport(id, edge, auth.userId, result.partial)
  } catch (err) {
    console.error('[check-report] gear settle failed:', err)
  }

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
  // Gated on orderLinesChanged: a sheet that moved nothing must not
  // re-send an identical "updated quote" — that teaches the client to
  // ignore the next one that is real. And a line the dock added by NAME
  // sits on the order at $0 with the flag: the client is not sent a
  // quote carrying a free line. The agent prices it and sends it.
  if (edge === 'OUT' && result.orderLinesChanged) {
    if (result.unpriced.length > 0) {
      resend = {
        sent: false,
        reason: `${result.unpriced.join(', ')} ${result.unpriced.length === 1 ? 'was' : 'were'} added without a catalog rate and still ${result.unpriced.length === 1 ? 'needs' : 'need'} a price`,
      }
    } else {
      try {
        resend = await resendQuoteAfterCheckOut({ orderId: id, changes: result.changes })
      } catch (err) {
        console.error('[check-report] quote re-send failed:', err)
        resend = { sent: false, reason: err instanceof Error ? err.message : 'the re-send failed' }
      }
    }
  }

  return NextResponse.json({ ok: true, ...result, resend, gear })
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
