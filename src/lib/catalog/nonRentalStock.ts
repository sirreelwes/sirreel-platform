/**
 * Barcoded gear that is ours and is not rental inventory.
 *
 * RentalWorks' item register is a register of THINGS SirReel owns, and
 * not everything it owns goes out on an order. Wes, 2026-09-18, on the
 * eight "Jumper Box" units nobody could find a catalog row for: "the
 * jumper boxes are jump starters for the trucks." Shop kit. There is no
 * row because there should not be one.
 *
 * Without somewhere to say that, the nightly sync reports them as
 * unmatched every morning for ever — and a report that cries wolf about
 * the same eight units daily is how the morning a REAL code goes
 * unmatched gets ignored. So this is a list of answers, not a list of
 * problems: each entry says what the gear is and who decided.
 *
 * It does NOT hide the units. They stay in the register, they keep their
 * barcodes, and a scan still resolves them — it just says what they are
 * instead of asking someone to go and match them.
 *
 * Add an entry only for gear that genuinely never goes on an order. Gear
 * that fills SOMEBODY's order under a different name belongs in
 * lib/catalog/stockFills.ts instead.
 */

export interface NonRentalStock {
  /** RW item-register ICode. */
  icode: string
  /** What ONE of them is, in the words the yard would use — it is read
   *  back to whoever scanned one ("SR004661 is a jump starter that…"),
   *  so it reads as a singular noun phrase, not a category. */
  what: string
  /** Who said so, and when. */
  ruling: string
}

export const NON_RENTAL_STOCK: readonly NonRentalStock[] = [
  {
    icode: '105159',
    what: 'A jump starter that lives on the trucks',
    ruling: 'Wes, 2026-09-18 — "the jumper boxes are jump starters for the trucks"',
  },
]

export function isNonRentalRwCode(icode: string | null | undefined): boolean {
  return !!icode && NON_RENTAL_STOCK.some((r) => r.icode === icode)
}

/** What to tell whoever just scanned one, or null when it is not on the list. */
export function nonRentalStockFor(icode: string | null | undefined): NonRentalStock | null {
  if (!icode) return null
  return NON_RENTAL_STOCK.find((r) => r.icode === icode) ?? null
}
