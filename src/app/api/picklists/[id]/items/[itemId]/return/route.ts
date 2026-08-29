/**
 * POST /api/picklists/[id]/items/[itemId]/return — count one line back in.
 *
 * The inbound counterpart to .../pick. The checker enters how many of
 * this line actually came back; the line lands RETURNED when the count
 * matches what went out and SHORT when it doesn't.
 *
 * Counted against OrderLineItem.quantity read at check-in time, never a
 * copy of it — a post-book quantity edit has to move the target rather
 * than orphan it against a stale snapshot.
 *
 * SHORT is a flag, not a charge. It records what is missing and who
 * counted; billing the client for a lost charging bank stays a human
 * decision on the order. Automating that off a warehouse count would
 * put a line on an invoice with nobody's name against it.
 *
 * Body: { qtyReturned: number, note?: string }
 *   - qtyReturned must be an integer in [0, quantity]. More than went
 *     out is refused: it means the checker is counting someone else's
 *     gear onto this order, which is how the wrong client gets billed.
 *   - note is REQUIRED when the count is short. "3 batteries not in the
 *     case" is the entire value of the record to whoever bills later.
 *
 * Role-gated to the warehouse permission (ADMIN | MANAGER | WAREHOUSE).
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePickerRole } from '@/lib/warehouse/requirePickerRole'

export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  { params }: { params: { id: string; itemId: string } },
) {
  const auth = await requirePickerRole()
  if (!auth.ok) return auth.response

  const body = (await req.json().catch(() => ({}))) as {
    qtyReturned?: unknown
    note?: unknown
  }

  const item = await prisma.pickListItem.findUnique({
    where: { id: params.itemId },
    select: {
      id: true,
      pickListId: true,
      qtyReturned: true,
      pickList: { select: { id: true, status: true } },
      orderLineItem: {
        select: {
          id: true,
          quantity: true,
          description: true,
          pickStatus: true,
          autoKitPieceId: true,
          inventoryItem: { select: { code: true, replacementCost: true } },
        },
      },
    },
  })
  if (!item || item.pickListId !== params.id) {
    return NextResponse.json({ error: 'pick list item not found' }, { status: 404 })
  }
  if (item.pickList.status !== 'CHECKING_IN') {
    return NextResponse.json(
      {
        error: 'check-in not open',
        reason: `pick list is in status=${item.pickList.status}; open the check-in pass first`,
        currentStatus: item.pickList.status,
      },
      { status: 409 },
    )
  }

  const expected = item.orderLineItem.quantity
  const raw = Number(body.qtyReturned)
  if (!Number.isInteger(raw) || raw < 0) {
    return NextResponse.json(
      { error: 'qtyReturned must be a whole number of zero or more' },
      { status: 400 },
    )
  }
  if (raw > expected) {
    return NextResponse.json(
      {
        error: 'more returned than went out',
        reason: `${raw} counted against ${expected} on the order. Counting surplus gear onto this list bills it to the wrong client — correct the order line instead.`,
        expected,
      },
      { status: 400 },
    )
  }

  const note = typeof body.note === 'string' ? body.note.trim() : ''
  const short = raw < expected
  if (short && !note) {
    return NextResponse.json(
      {
        error: 'note required',
        reason: `${expected - raw} of ${expected} × ${item.orderLineItem.description} did not come back. Say what happened — this note is what the person billing the client reads.`,
      },
      { status: 400 },
    )
  }

  const returnedAt = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.pickListItem.update({
      where: { id: item.id },
      data: {
        qtyReturned: raw,
        returnedById: auth.userId,
        returnedAt,
        returnNote: note || null,
      },
    })
    await tx.orderLineItem.update({
      where: { id: item.orderLineItem.id },
      data: { pickStatus: short ? 'SHORT' : 'RETURNED' },
    })
    // Only shortfalls get their own audit row. A clean return is
    // already recorded on the PickListItem; a row per counted line
    // would bury the handful that actually need chasing.
    if (short) {
      await tx.auditLog.create({
        data: {
          userId: auth.userId,
          action: 'picklist.item_short',
          entityType: 'PickListItem',
          entityId: item.id,
          oldValues: { expected, description: item.orderLineItem.description },
          newValues: {
            qtyReturned: raw,
            missing: expected - raw,
            note,
            code: item.orderLineItem.inventoryItem?.code ?? null,
            replacementCost:
              item.orderLineItem.inventoryItem?.replacementCost?.toString() ?? null,
            wasIncludedAccessory: !!item.orderLineItem.autoKitPieceId,
          },
        },
      })
    }
  })

  return NextResponse.json({
    ok: true,
    itemId: item.id,
    qtyReturned: raw,
    expected,
    missing: expected - raw,
    status: short ? 'SHORT' : 'RETURNED',
    // Surfaced so the checker sees the consequence at the moment of
    // counting, not a week later on an invoice dispute.
    replacementCost: item.orderLineItem.inventoryItem?.replacementCost?.toString() ?? null,
    returnedAt,
  })
}
