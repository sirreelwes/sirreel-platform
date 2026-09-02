import { prisma } from '@/lib/prisma'

/**
 * The write half of picking one line: flip the line to PICKED, stamp the
 * picker metadata, and log it.
 *
 * Extracted when the scan resolver landed (barcode phase 2) so the
 * per-item endpoint and the new scan endpoint cannot drift on what
 * "picked" means — the audit row in particular, which is the only record
 * of WHAT was scanned once the pick list is closed.
 *
 * `scannedCode` is stored as scanned (normalised), which for a barcode
 * pick means the row now names the individual unit that left the
 * building — the first per-unit fact HQ has ever recorded. It is not yet
 * a relation: PickListItem is one row per LINE, and making it many rows
 * per unit is phase 3, deliberately not done here.
 */
export async function markPicked(args: {
  pickListItemId: string
  orderLineItemId: string
  userId: string
  scannedCode: string | null
  manualOverride: boolean
  /** Set when the scan was resolved through the RW unit register — the
   *  audit row records which unit, not just which product. */
  inventoryUnitId?: string | null
}) {
  const pickedAt = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.orderLineItem.update({
      where: { id: args.orderLineItemId },
      data: { pickStatus: 'PICKED' },
    })
    await tx.pickListItem.update({
      where: { id: args.pickListItemId },
      data: {
        scannedCode: args.scannedCode,
        pickedById: args.userId,
        pickedAt,
      },
    })
    await tx.auditLog.create({
      data: {
        userId: args.userId,
        action: 'picklistitem.picked',
        entityType: 'PickListItem',
        entityId: args.pickListItemId,
        oldValues: { pickStatus: 'PENDING_PICK' },
        newValues: {
          pickStatus: 'PICKED',
          scannedCode: args.scannedCode,
          manualOverride: args.manualOverride,
          inventoryUnitId: args.inventoryUnitId ?? null,
          pickedAt: pickedAt.toISOString(),
        },
      },
    })
  })
  return pickedAt
}
