/**
 * Which LineItemType a catalog pick becomes — the ONE answer, for every
 * door an order line comes in through.
 *
 * Lived in /api/orders/from-parse until 2026-09-08, then in
 * src/lib/sales/parseQuoteItems.ts when the paste-onto-an-existing-order
 * path needed it too and guessed instead ('INVENTORY' / 'ASSET', which are
 * not members of the enum, so every line 400'd). It moved HERE on
 * 2026-09-14 because the two remaining doors — the reservation modal and
 * the order page's inline row editor — are client components, and
 * parseQuoteItems pulls in prisma and the Anthropic SDK. This module is
 * pure: no prisma, no env, safe to bundle.
 *
 * WHY THE STAGES CLAUSE: a stage day is legitimately EQUIPMENT in the
 * STAGES department (see stageLines.ts — LineItemType has no STAGE member
 * on purpose). But MakeReservationModal posted `type: 'VEHICLE'` for every
 * asset-category row, its own department union being VEHICLES | STAGES,
 * while the order page re-derived EQUIPMENT from the catalog binding on the
 * next save. So the same stage row was VEHICLE on Monday and EQUIPMENT on
 * Tuesday — observed 2026-09-14 on S260914-007's "Lankershim Studios" line,
 * which read VEHICLE until Wes saved it and EQUIPMENT after. The stored
 * value decided which controls the row offered, so the row argued with
 * itself. EQUIPMENT is the canonical value, and it is what the catalog row
 * itself says (CAT_STUDIOS.type = EQUIPMENT).
 *
 * The rule deliberately special-cases STAGES and nothing else. Department
 * is NOT a safe way to derive VEHICLE in the other direction: the
 * department re-flattening left live catalog rows carrying VEHICLE under
 * PRO_SUPPLIES, and re-deriving from the department would retype them.
 */

import type { LineItemDepartment, LineItemType } from '@prisma/client'

export function resolveLineType(
  itemType: 'INVENTORY' | 'ASSET_CATEGORY' | 'PACKAGE' | null | undefined,
  department: LineItemDepartment,
  catalogLineType?: LineItemType | null,
): LineItemType {
  if (itemType === 'PACKAGE') return 'EQUIPMENT'
  // Nothing on a stage is a truck. The catalog row still gets to say
  // EXPENDABLE (gaff tape re-departmented onto a stage order); it just
  // cannot say VEHICLE.
  if (department === 'STAGES') {
    return catalogLineType && catalogLineType !== 'VEHICLE' ? catalogLineType : 'EQUIPMENT'
  }
  if (catalogLineType) return catalogLineType
  if (itemType === 'ASSET_CATEGORY') return 'VEHICLE'
  if (department === 'EXPENDABLES') return 'EXPENDABLE'
  return 'EQUIPMENT'
}

/**
 * Physical goods — the lines somebody has to walk out and pull. Fees,
 * discounts and labor have nothing on a shelf.
 *
 * Lived in lib/warehouse/sendPullOrder.ts until 2026-09-18, when the
 * added-after-the-pull derivation needed the same filter and could not
 * import that module without a cycle (sendPullOrder now reads it). Here
 * it stays pure — no prisma, no mail — so any surface can ask.
 */
export function isPickableLine(li: { type: string }): boolean {
  return li.type !== 'FEE' && li.type !== 'DISCOUNT' && li.type !== 'LABOR'
}
