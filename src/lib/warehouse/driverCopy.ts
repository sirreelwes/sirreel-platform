/**
 * The driver's copy — the pick list AFTER the check-out sheet is filed.
 *
 * Wes, 2026-09-12: "warehouse typically prints a copy of the completed
 * pull list to give to the client. On this printed pull list the numbers
 * in the picked column are printed to show we picked as many items as
 * they ordered … when they enter all of the picked quantities and make
 * the out contract, they don't have the ability to print the pick list
 * with the completed quantities to give to the driver. This is an
 * important feature, as it's the driver's receipt."
 *
 * This is the pure half: given the order's pickable lines and the filed
 * OUT report's rows, which lines go on the paper and what number prints
 * in each Picked box. renderPickListPdf does the loading and drawing.
 *
 *   - a report row with onSheet=false is a line that STAYED ON THE SHELF
 *     (partial pull) — it is left off the copy and counted as omitted,
 *     so the sheet says PARTIAL and the driver is not handed a receipt
 *     for gear still in the building;
 *   - a report row on the sheet prints its actual count, ZERO INCLUDED —
 *     "did not send" is something the driver should be able to read off
 *     the paper rather than discover at the set;
 *   - a line with NO report row (sales added it after the sheet was
 *     filed) prints a blank box: nobody counted it, and printing the
 *     ordered quantity would claim they had.
 */

export interface FiledSheetRow {
  orderLineItemId: string | null
  actualQty: number
  onSheet: boolean
}

export interface DriverCopyLine<L> {
  line: L
  /** What prints in the Picked box; null = blank (never counted). */
  pickedQty: number | null
}

export function applyFiledSheet<L extends { id: string }>(
  lines: L[],
  rows: FiledSheetRow[],
): { onSheet: DriverCopyLine<L>[]; omittedLineCount: number } {
  const byLine = new Map<string, FiledSheetRow>()
  for (const r of rows) if (r.orderLineItemId) byLine.set(r.orderLineItemId, r)

  const onSheet: DriverCopyLine<L>[] = []
  let omittedLineCount = 0
  for (const line of lines) {
    const row = byLine.get(line.id)
    if (row && !row.onSheet) {
      omittedLineCount++
      continue
    }
    onSheet.push({ line, pickedQty: row ? Math.max(0, row.actualQty) : null })
  }
  return { onSheet, omittedLineCount }
}
