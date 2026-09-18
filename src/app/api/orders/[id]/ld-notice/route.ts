/**
 * /api/orders/[id]/ld-notice — tell the production what did not come back.
 *
 * Wes, 2026-09-18: the L&D flow should cue Ana to *"first notify the
 * production with those replacement items if they're lost, and what that
 * would cost, or to be able to write in something about damage and the cost
 * that that would be."*
 *
 *   GET  — what the notice would say, who it would go to (read-only).
 *   POST — freeze the lines Ana ticked and priced, and send it.
 *
 * Gated on the COLLECTIONS desk, not the yard. This surface prices things,
 * and the yard deliberately cannot see rates
 * (src/lib/yard/requireYardAccess.ts is the wrong door for it).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireCollectionsUser } from '@/lib/collections/access'
import {
  composeLdNotice,
  sendLdNotice,
  type StoredLdNoticeLine,
} from '@/lib/invoices/ldNotice'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const composition = await composeLdNotice(params.id)
  if (!composition) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  return NextResponse.json({ ok: true, ...composition })
}

/**
 * One composed line. A zero PRICE is allowed and meaningful here in a way it
 * never is on an invoice: the notice can legitimately say "this did not come
 * back and we are still working out what it costs". A missing description or
 * a non-positive quantity is a bug in the composer, not something to mail a
 * client.
 */
function parseLine(raw: unknown): StoredLdNoticeLine | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const description = typeof r.description === 'string' ? r.description.trim().slice(0, 500) : ''
  const qty = Number(r.qty)
  const unitPrice = Number(r.unitPrice)
  if (!description) return null
  if (!Number.isFinite(qty) || qty <= 0) return null
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return null
  return {
    key: typeof r.key === 'string' && r.key ? r.key.slice(0, 120) : `manual:${description.slice(0, 40)}`,
    description,
    qty: Math.round(qty),
    unitPrice: Math.round(unitPrice * 100) / 100,
    kind: r.kind === 'MISSING' ? 'MISSING' : 'DAMAGE',
    note: typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, 500) : null,
    ...(typeof r.damageItemId === 'string' ? { damageItemId: r.damageItemId } : {}),
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as {
    lines?: unknown
    note?: unknown
    toEmail?: unknown
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ ok: false, error: 'pick at least one item to notify them about' }, { status: 400 })
  }
  const parsed = body.lines.map(parseLine)
  if (parsed.some((l) => l === null)) {
    return NextResponse.json(
      { ok: false, error: 'every line needs a description and a quantity above zero' },
      { status: 400 },
    )
  }

  const result = await sendLdNotice({
    orderId: params.id,
    lines: parsed as StoredLdNoticeLine[],
    note: typeof body.note === 'string' ? body.note : null,
    senderId: user.id,
    senderName: user.name,
    senderEmail: user.email,
    toEmailOverride: typeof body.toEmail === 'string' ? body.toEmail : null,
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
  }
  return NextResponse.json(result, { status: 201 })
}
