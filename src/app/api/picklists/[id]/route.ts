/**
 * GET /api/picklists/[id] — single PickList detail view.
 *
 * Returns the PickList, its order context, and every PickListItem
 * with the underlying OrderLineItem fields the picking floor needs:
 * description, quantity, the InventoryItem.code (used as the scan
 * target), and the authoritative OrderLineItem.pickStatus.
 *
 * Sort: items by OrderLineItem.sortOrder so the picking floor mirrors
 * the order detail page's line ordering.
 *
 * Role-gated to ADMIN | MANAGER via requirePickerRole.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePickerRole } from '@/lib/warehouse/requirePickerRole'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePickerRole()
  if (!auth.ok) return auth.response

  const picklist = await prisma.pickList.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      assignedTo: { select: { id: true, name: true } },
      order: {
        select: {
          id: true,
          orderNumber: true,
          startDate: true,
          endDate: true,
          company: { select: { id: true, name: true } },
          job: { select: { id: true, jobCode: true, name: true } },
        },
      },
      items: {
        select: {
          id: true,
          scannedCode: true,
          pickedAt: true,
          pickedBy: { select: { id: true, name: true } },
          orderLineItem: {
            select: {
              id: true,
              sortOrder: true,
              description: true,
              quantity: true,
              department: true,
              pickStatus: true,
              inventoryItem: { select: { id: true, code: true, description: true } },
            },
          },
        },
      },
    },
  })

  if (!picklist) {
    return NextResponse.json({ error: 'pick list not found' }, { status: 404 })
  }

  // Sort items by the underlying OrderLineItem.sortOrder.
  const sortedItems = [...picklist.items].sort(
    (a, b) => a.orderLineItem.sortOrder - b.orderLineItem.sortOrder,
  )

  return NextResponse.json({
    picklist: {
      ...picklist,
      items: sortedItems,
    },
  })
}
