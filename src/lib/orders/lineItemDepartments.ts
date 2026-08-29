/**
 * Canonical department ordering for order line items.
 *
 * The client-facing Quote PDF has always grouped its line items by
 * department (QuoteDocument's section flow); the internal order page
 * did not — it rendered a flat list in `sortOrder` (insertion) order.
 * So a rep reconciling client comments against the PDF they sent was
 * reading two different documents: "the four Director's Chairs lines"
 * sat next to each other on the PDF and 20 rows apart on screen.
 *
 * This module is the ONE ordering both surfaces read, so they can't
 * drift again. Labels differ on purpose: the PDF speaks to clients
 * ("Studios", "Grip & Electric"), the internal table speaks to staff
 * ("Stages", "G&E") and matches the department <select> on the row
 * editor.
 */

export const LINE_ITEM_DEPARTMENT_ORDER = [
  'VEHICLES',
  'GE',
  'COMMUNICATIONS',
  'STAGES',
  'PRO_SUPPLIES',
  'WARDROBE_MAKEUP',
  'EXPENDABLES',
  'ART',
] as const

export type LineItemDepartmentKey = (typeof LINE_ITEM_DEPARTMENT_ORDER)[number]

/** Internal (staff-facing) labels — mirrors the row editor's <select>. */
export const LINE_ITEM_DEPARTMENT_LABELS: Record<LineItemDepartmentKey, string> = {
  VEHICLES: 'Vehicles',
  GE: 'G&E',
  COMMUNICATIONS: 'Communications',
  STAGES: 'Stages',
  PRO_SUPPLIES: 'Pro Supplies',
  WARDROBE_MAKEUP: 'Wardrobe & Makeup',
  EXPENDABLES: 'Expendables',
  ART: 'Art',
}

/** A real department, or the synthetic bucket standalone fees land in. */
export type LineItemSectionKey = LineItemDepartmentKey | 'FEES'

export function lineItemSectionLabel(key: LineItemSectionKey): string {
  return key === 'FEES' ? 'Fees' : (LINE_ITEM_DEPARTMENT_LABELS[key] ?? key)
}

/** Minimal shape the grouper needs — deliberately structural so both the
 *  page's LineItem and the PDF's QuoteLineItem satisfy it. */
export type GroupableLine = {
  id: string
  department: string
  type?: string | null
  parentLineItemId?: string | null
}

export type LineItemSection<T> = { key: LineItemSectionKey; items: T[] }

/**
 * Group lines into department sections, matching the Quote PDF's rules:
 *
 *  - Kit pieces / ancillaries (`parentLineItemId`) are NOT hoisted into
 *    their own department. They render directly beneath their parent,
 *    inside the parent's section — two coaches each carry their own
 *    mileage and the reader has to be able to tell whose is whose.
 *  - A standalone FEE (no parent, no children) goes to a "Fees" section
 *    that always renders last.
 *  - Unknown departments fall to the end, before Fees.
 *
 * Within a section, the caller's incoming order (sortOrder) is
 * preserved — this regroups, it does not re-sort.
 */
export function groupLineItemsByDepartment<T extends GroupableLine>(
  items: T[],
): Array<LineItemSection<T>> {
  const buckets = new Map<string, T[]>()
  const feeLines: T[] = []

  const childrenOf = new Map<string, T[]>()
  for (const it of items) {
    if (!it.parentLineItemId) continue
    const list = childrenOf.get(it.parentLineItemId) ?? []
    list.push(it)
    childrenOf.set(it.parentLineItemId, list)
  }

  for (const it of items) {
    if (it.parentLineItemId) continue // placed under its parent below
    const kids = childrenOf.get(it.id) ?? []
    if (it.type === 'FEE' && kids.length === 0) {
      feeLines.push(it)
      continue
    }
    const list = buckets.get(it.department) ?? []
    list.push(it, ...kids)
    buckets.set(it.department, list)
  }

  const sections: Array<LineItemSection<T>> = []
  for (const dept of LINE_ITEM_DEPARTMENT_ORDER) {
    const list = buckets.get(dept)
    if (list && list.length > 0) {
      sections.push({ key: dept, items: list })
      buckets.delete(dept)
    }
  }
  for (const [dept, list] of buckets) {
    sections.push({ key: dept as LineItemSectionKey, items: list })
  }
  if (feeLines.length > 0) sections.push({ key: 'FEES', items: feeLines })
  return sections
}
