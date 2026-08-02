/**
 * Does a line item put this order on a stage?
 *
 * `department` is the canonical answer. `routeDepartment()` in bookOrder.ts
 * maps STAGES → the STAGE fulfillment lane, and every stage line booked
 * through the order builder carries it.
 *
 * There is deliberately NO stage value in LineItemType — VEHICLE /
 * EQUIPMENT / EXPENDABLE / LABOR / FEE / DISCOUNT describe what a line
 * *is*, not which part of the business sells it. A stage day is
 * legitimately EQUIPMENT in the STAGES department. Two call sites used to
 * test `type === 'STAGE'`, which can never be true, so stage orders fell
 * through their contract gates entirely.
 *
 * The asset-category name/slug test is kept as a fallback for older lines
 * written before department was populated.
 */
export function isStageLineItem(li: {
  department?: string | null
  fulfillmentLane?: string | null
  assetCategory?: { name?: string | null; slug?: string | null } | null
}): boolean {
  if (li.department === 'STAGES') return true
  if (li.fulfillmentLane === 'STAGE') return true
  return (
    /stage/i.test(li.assetCategory?.name || '') || /stage/i.test(li.assetCategory?.slug || '')
  )
}
