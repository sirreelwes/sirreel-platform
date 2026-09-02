/**
 * POST /api/picklists/[id]/items/[itemId]/pick
 *
 * Marks a single PickListItem as PICKED. Two modes:
 *
 *   { scannedCode: "SR004674" }     — scan mode. Resolved by
 *                                     lib/warehouse/resolveScan: either
 *                                     the line's own catalog code, or a
 *                                     per-unit RW barcode that resolves
 *                                     to the same catalog row (barcode
 *                                     phase 2). 409 when it resolves to
 *                                     something else, or to nothing.
 *   { manualOverride: true }        — manual check-off fallback. For
 *                                     line items without a scannable
 *                                     SKU (vehicle category rentals,
 *                                     flat fees, etc.) or when the
 *                                     scanner is down.
 *
 * Exactly one of the two must be provided.
 *
 * Effects on success:
 *   - OrderLineItem.pickStatus = 'PICKED' (authoritative).
 *   - PickListItem.scannedCode = body.scannedCode (or null on manual).
 *   - PickListItem.pickedById = session user.
 *   - PickListItem.pickedAt   = now().
 *   - AuditLog row (action='picklistitem.picked').
 *
 * Guards:
 *   - PickList must be in PICKING state.
 *   - PickListItem must belong to this PickList.
 *   - OrderLineItem.pickStatus must currently be PENDING_PICK (re-picking
 *     a line returns 409 with currentStatus so the UI can show the
 *     conflict).
 *
 * Role-gated to ADMIN | MANAGER.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePickerRole } from '@/lib/warehouse/requirePickerRole'
import { resolveScan } from '@/lib/warehouse/resolveScan'
import { markPicked } from '@/lib/warehouse/markPicked'

export const dynamic = 'force-dynamic'

interface PickBody {
  scannedCode?: unknown
  manualOverride?: unknown
}

export async function POST(req: NextRequest, { params }: { params: { id: string; itemId: string } }) {
  const auth = await requirePickerRole()
  if (!auth.ok) return auth.response

  const body = (await req.json().catch(() => ({}))) as PickBody
  const scannedCode = typeof body.scannedCode === 'string' ? body.scannedCode.trim() : null
  const manualOverride = body.manualOverride === true

  if (!scannedCode && !manualOverride) {
    return NextResponse.json(
      { error: 'either scannedCode or manualOverride must be provided' },
      { status: 400 },
    )
  }
  if (scannedCode && manualOverride) {
    return NextResponse.json(
      { error: 'pass exactly one of scannedCode or manualOverride, not both' },
      { status: 400 },
    )
  }

  const item = await prisma.pickListItem.findUnique({
    where: { id: params.itemId },
    select: {
      id: true,
      pickListId: true,
      pickedAt: true,
      pickList: { select: { id: true, status: true } },
      orderLineItem: {
        select: {
          id: true,
          pickStatus: true,
          description: true,
          // The catalog ROW is what a scan has to agree with — a unit
          // barcode never equals the product code, it resolves to it.
          inventoryItemId: true,
          inventoryItem: { select: { code: true } },
        },
      },
    },
  })
  if (!item) {
    return NextResponse.json({ error: 'pick list item not found' }, { status: 404 })
  }
  if (item.pickListId !== params.id) {
    return NextResponse.json(
      { error: 'item does not belong to this pick list' },
      { status: 400 },
    )
  }
  if (item.pickList.status !== 'PICKING') {
    return NextResponse.json(
      {
        error: 'cannot pick',
        reason: `pick list is in status=${item.pickList.status}; items can be picked only while PICKING`,
        currentStatus: item.pickList.status,
      },
      { status: 409 },
    )
  }
  if (item.orderLineItem.pickStatus !== 'PENDING_PICK') {
    return NextResponse.json(
      {
        error: 'cannot pick',
        reason: `line item is in status=${item.orderLineItem.pickStatus}; picking only allowed from PENDING_PICK`,
        currentStatus: item.orderLineItem.pickStatus,
      },
      { status: 409 },
    )
  }

  // Scan-mode verification. The scan is RESOLVED rather than compared:
  // a picker holding a walkie scans `SR004674`, which is that unit's
  // barcode in RentalWorks and never equals HQ's product code. Both
  // forms have to land on the same catalog row.
  let resolvedUnitId: string | null = null
  let recordedCode = scannedCode
  if (scannedCode) {
    const expectedItemId = item.orderLineItem.inventoryItemId
    if (!expectedItemId) {
      return NextResponse.json(
        {
          error: 'no scannable code on this line',
          reason: 'line item has no linked catalog item; use manualOverride',
        },
        { status: 409 },
      )
    }
    const res = await resolveScan(scannedCode)
    recordedCode = res.scanned
    const gotItemId =
      res.kind === 'catalog' || res.kind === 'unit' ? res.inventoryItemId : null
    if (!gotItemId) {
      return NextResponse.json(
        {
          error: 'scan mismatch',
          reason:
            res.kind === 'unlinked-unit'
              ? `${res.scanned} is a known unit (RW item ${res.unit.rwICode}) but isn't matched to an HQ catalog item — pick it manually and flag it.`
              : `${res.scanned} isn't a code or a barcode we know.`,
          resolution: res.kind,
        },
        { status: 409 },
      )
    }
    if (gotItemId !== expectedItemId) {
      const expected = item.orderLineItem.inventoryItem?.code
      return NextResponse.json(
        {
          error: 'scan mismatch',
          reason: `scanned ${res.scanned} but this line expects ${expected ?? 'a different item'}`,
          expectedCode: expected ?? null,
          resolution: res.kind,
        },
        { status: 409 },
      )
    }
    if (res.kind === 'unit') resolvedUnitId = res.unit.id
  }

  const pickedAt = await markPicked({
    pickListItemId: item.id,
    orderLineItemId: item.orderLineItem.id,
    userId: auth.userId,
    scannedCode: recordedCode ?? null,
    manualOverride: !!manualOverride,
    inventoryUnitId: resolvedUnitId,
  })

  return NextResponse.json({
    ok: true,
    item: {
      id: item.id,
      pickStatus: 'PICKED',
      scannedCode: recordedCode ?? null,
      pickedAt,
    },
  })
}
