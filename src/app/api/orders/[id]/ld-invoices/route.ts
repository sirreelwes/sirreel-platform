/**
 * POST /api/orders/[id]/ld-invoices  — generate an LD invoice.
 *
 * Phase 5 commit 4. Picks up all SEND_TO_LD damage items on the
 * order that haven't already been billed and spins up a new LD
 * invoice (type=LD) carrying them as DAMAGE lines.
 *
 * Non-blocking on the rental arc per doctrine: LD invoices don't
 * gate Order.status — Order CLOSED is reachable with an open LD
 * invoice/claim.
 *
 * 2026-09-14: also accepts `lines` — what the billing desk ticked and priced
 * in the L&D composer (gear off the check-in sheet as well as vehicle
 * damage). With `lines` the damage sweep is skipped; see generateLdInvoice.
 *
 * GET returns the candidates for that composer.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { generateLdInvoice, type LdInvoiceLineInput } from '@/lib/invoices/generateLdInvoice'
import { buildLdCandidates } from '@/lib/invoices/ldCandidates'

/** What is billable as L&D on this order, priced where HQ holds a figure. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const set = await buildLdCandidates(params.id)
  if (!set) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  return NextResponse.json({ ok: true, ...set })
}

/**
 * Validate one composed line. A line with no description or a non-positive
 * quantity is a bug in the composer, not something to silently bill; a zero
 * PRICE is allowed because an operator may deliberately list a found item at
 * no charge alongside the ones they are billing for.
 */
function parseLine(raw: unknown): LdInvoiceLineInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const description = typeof r.description === 'string' ? r.description.trim().slice(0, 500) : ''
  const qty = Number(r.qty)
  const unitPrice = Number(r.unitPrice)
  if (!description) return null
  if (!Number.isFinite(qty) || qty <= 0) return null
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return null
  return {
    description,
    category: typeof r.category === 'string' && r.category.trim() ? r.category.trim().slice(0, 200) : null,
    qty: Math.round(qty),
    unitPrice: Math.round(unitPrice * 100) / 100,
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    dueDate?: unknown
    notes?: unknown
    lines?: unknown
    damageItemIds?: unknown
  }
  const dueDate =
    typeof body.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)
      ? new Date(`${body.dueDate}T00:00:00.000Z`)
      : null
  const notes =
    typeof body.notes === 'string' && body.notes.trim().length > 0
      ? body.notes.trim().slice(0, 5000)
      : null

  let lines: LdInvoiceLineInput[] | null = null
  if (Array.isArray(body.lines) && body.lines.length > 0) {
    const parsed = body.lines.map(parseLine)
    if (parsed.some((l) => l === null)) {
      return NextResponse.json(
        { ok: false, error: 'every line needs a description, a quantity above zero and a price' },
        { status: 400 },
      )
    }
    lines = parsed as LdInvoiceLineInput[]
  }

  const damageItemIds = Array.isArray(body.damageItemIds)
    ? body.damageItemIds.filter((v): v is string => typeof v === 'string')
    : null

  const result = await generateLdInvoice({
    orderId: params.id,
    dueDate,
    notes,
    lines,
    damageItemIds,
  })

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, existingInvoiceId: result.existingInvoiceId },
      { status: result.status },
    )
  }

  return NextResponse.json(result, { status: 201 })
}
