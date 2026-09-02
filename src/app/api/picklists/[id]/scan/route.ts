import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePickerRole } from '@/lib/warehouse/requirePickerRole'
import { resolveScan, describeUnlanded } from '@/lib/warehouse/resolveScan'
import { markPicked } from '@/lib/warehouse/markPicked'

export const dynamic = 'force-dynamic'

/**
 * POST /api/picklists/[id]/scan — "someone scanned this; work out what
 * it is and pick it" (barcode phase 2).
 *
 * Body: { code: string }
 *
 * Replaces the client-side target-finding the picking floor used to do.
 * That code matched the scan against `inventoryItem.code` in the browser,
 * which is the only thing it COULD do — the browser has no idea that
 * `SR004674` is a walkie. Resolution needs the unit register, so it moves
 * to the server and the client just forwards the keystrokes.
 *
 * Picks the first PENDING_PICK line on this list whose catalog row the
 * scan resolves to. One scan, one line: several lines of the same product
 * are picked one scan at a time, which is the existing behaviour and the
 * right one — the picker is counting as they go.
 *
 * Every miss comes back with a REASON the picker can act on, because at
 * the shelf "no" is useless: not a code we know / known unit but
 * unmatched in the catalog / on the list but already picked / not on this
 * list at all.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requirePickerRole()
  if (!auth.ok) return auth.response

  const body = (await req.json().catch(() => ({}))) as { code?: unknown }
  const raw = typeof body.code === 'string' ? body.code : ''
  if (!raw.trim()) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 })
  }

  const pickList = await prisma.pickList.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      items: {
        select: {
          id: true,
          orderLineItem: {
            select: { id: true, pickStatus: true, inventoryItemId: true, description: true },
          },
        },
      },
    },
  })
  if (!pickList) {
    return NextResponse.json({ error: 'pick list not found' }, { status: 404 })
  }
  if (pickList.status !== 'PICKING') {
    return NextResponse.json(
      {
        error: 'cannot pick',
        reason: `pick list is in status=${pickList.status}; items can be picked only while PICKING`,
      },
      { status: 409 },
    )
  }

  const res = await resolveScan(raw)
  const targetItemId =
    res.kind === 'catalog' || res.kind === 'unit' ? res.inventoryItemId : null

  if (!targetItemId) {
    return NextResponse.json(
      { error: 'no match', reason: describeUnlanded(res, { onListButPicked: false }), resolution: res.kind },
      { status: 409 },
    )
  }

  const onList = pickList.items.filter((i) => i.orderLineItem.inventoryItemId === targetItemId)
  const target = onList.find((i) => i.orderLineItem.pickStatus === 'PENDING_PICK')
  if (!target) {
    return NextResponse.json(
      {
        error: 'no match',
        reason: describeUnlanded(res, { onListButPicked: onList.length > 0 }),
        resolution: res.kind,
      },
      { status: 409 },
    )
  }

  const pickedAt = await markPicked({
    pickListItemId: target.id,
    orderLineItemId: target.orderLineItem.id,
    userId: auth.userId,
    scannedCode: res.scanned,
    manualOverride: false,
    inventoryUnitId: res.kind === 'unit' ? res.unit.id : null,
  })

  return NextResponse.json({
    ok: true,
    // How the scan was understood — the floor UI says "walkie SR004674"
    // rather than echoing a number back at someone holding the thing.
    resolution: res.kind,
    matched: res.kind === 'unit'
      ? { barcode: res.unit.barcode, description: res.unit.description, rwICode: res.unit.rwICode }
      : { code: res.kind === 'catalog' ? res.code : null },
    item: {
      id: target.id,
      description: target.orderLineItem.description,
      pickStatus: 'PICKED',
      scannedCode: res.scanned,
      pickedAt,
    },
  })
}
