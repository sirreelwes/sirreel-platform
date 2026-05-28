/**
 * POST /api/picklists/[id]/items/[itemId]/pick
 *
 * Marks a single PickListItem as PICKED. Two modes:
 *
 *   { scannedCode: "SR-VEH-001" }   — scan mode. Code must match the
 *                                     underlying OrderLineItem's
 *                                     inventoryItem.code exactly; 409
 *                                     if it doesn't or there's no
 *                                     linked inventoryItem.
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

  // Scan-mode verification: code must match the linked InventoryItem.
  if (scannedCode) {
    const expected = item.orderLineItem.inventoryItem?.code
    if (!expected) {
      return NextResponse.json(
        {
          error: 'no scannable code on this line',
          reason: 'line item has no linked InventoryItem; use manualOverride',
        },
        { status: 409 },
      )
    }
    if (scannedCode !== expected) {
      return NextResponse.json(
        {
          error: 'scan mismatch',
          reason: `scanned ${scannedCode} but this line expects ${expected}`,
          expectedCode: expected,
        },
        { status: 409 },
      )
    }
  }

  const pickedAt = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.orderLineItem.update({
      where: { id: item.orderLineItem.id },
      data: { pickStatus: 'PICKED' },
    })
    await tx.pickListItem.update({
      where: { id: item.id },
      data: {
        scannedCode: scannedCode ?? null,
        pickedById: auth.userId,
        pickedAt,
      },
    })
    await tx.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'picklistitem.picked',
        entityType: 'PickListItem',
        entityId: item.id,
        oldValues: { pickStatus: 'PENDING_PICK' },
        newValues: {
          pickStatus: 'PICKED',
          scannedCode: scannedCode ?? null,
          manualOverride,
          pickedAt: pickedAt.toISOString(),
        },
      },
    })
  })

  return NextResponse.json({
    ok: true,
    item: {
      id: item.id,
      pickStatus: 'PICKED',
      scannedCode: scannedCode ?? null,
      pickedAt,
    },
  })
}
