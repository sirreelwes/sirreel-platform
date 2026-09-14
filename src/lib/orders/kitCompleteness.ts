/**
 * "Did the kit go out with the thing?" — the completeness check.
 *
 * Wes, 2026-09-13, after the second walkie order in one week left the
 * building with no antennas: "we need to make sure we have a workflow
 * that double-checks that the walkies, their antennas, their batteries,
 * and the spare batteries are all included in the rental."
 *
 * The catalog already knows what rides along with what
 * (InventoryKitPiece) and the reconciler already puts those lines on the
 * order (kitSync.ts). What nothing did was CHECK — a radio line counted
 * out at 12 next to an antenna line counted at 0 read as two ordinary
 * lines, and the sheet filed clean.
 *
 * This module is that check, and nothing else: given what the catalog
 * owes and what a person actually counted, it says what is short. It is
 * deliberately pure and prisma-free so the supervisor's screen can run
 * it live against the numbers being typed — the moment to catch this is
 * while the truck is still in the bay, not in a report afterwards.
 *
 * ── Two failure modes, one answer ──────────────────────────────────
 * The gear can be missing in two different ways and the fix differs:
 *
 *   - the line is ON the order and was counted short (or not at all) —
 *     the floor did not load it;
 *   - there is NO line for it on the order at all — the kit was
 *     configured after this order was written, or the line was typed by
 *     hand and never reconciled. `missingFromOrder` separates them, so
 *     the screen can send one to the floor and the other to the desk.
 *
 * ── The createdAt guard does NOT apply here ────────────────────────
 * `deriveKitPieceLines` counts only source lines written at or after the
 * kit row, so configuring an accessory today can never re-price a quote
 * that went out last week (Wes 2026-09-07). That guard is about MONEY.
 * A warning costs nothing and the radios on last week's order still need
 * antennas today, so the check looks at every line regardless of age.
 * This is the whole reason a pre-existing order still gets caught.
 */

import { resolveKitQuantity, type KitRatio } from '@/lib/inventory/kitMath'

export type { KitRatio }

/**
 * One promise the catalog makes about this order: a piece, the ratio it
 * comes at, the lines that pull it in, and the lines that carry it.
 *
 * Keyed by piece + ratio rather than by parent, matching how
 * `deriveKitPieceLines` groups: 6 analog and 6 digital radios need one
 * charging bank BETWEEN them, so the two parents are summed before the
 * ratio is applied. Checking per-parent would demand two banks and cry
 * short on an order that is perfectly loaded.
 */
export interface KitExpectation {
  /** Stable across a render — piece + ratio, the same key kitPieces groups on. */
  key: string
  pieceItemId: string
  pieceDescription: string
  ratio: KitRatio
  /** Parent item names, for wording ("12 × Motorola CP200 UHF Radio"). */
  parentNames: string[]
  /** Order line ids that are the parent — what the ratio is sized against. */
  parentLineIds: string[]
  /** Order line ids carrying the piece. Includes a line the CLIENT
   *  ordered themselves: the question here is whether the gear is on the
   *  truck, not who put it on the order. Empty = missing from the order. */
  pieceLineIds: string[]
}

export interface KitShortfall {
  key: string
  pieceItemId: string
  pieceDescription: string
  /** How many the parents counted out call for. */
  expected: number
  /** How many were actually counted. */
  counted: number
  /** Parent units counted out, and what they are. */
  parentQty: number
  parentNames: string[]
  /** No line for this piece exists on the order at all — the desk's fix,
   *  not the floor's. */
  missingFromOrder: boolean
}

/**
 * Counted quantities by order-line id.
 *
 * A line with no entry — or `null` — was not counted at all: left off a
 * partial sheet, or (for a piece) not on the order to begin with. Both
 * mean "none of it went", which is exactly what the check is looking
 * for. A deliberate split pull therefore raises the flag too; that is
 * intended, since the supervisor acknowledging it is cheap and a truck
 * leaving without antennas is not.
 */
export type CountedQuantities = Record<string, number | null | undefined>

function sum(ids: string[], counted: CountedQuantities): number {
  let total = 0
  for (const id of ids) {
    const n = counted[id]
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) total += Math.floor(n)
  }
  return total
}

/**
 * What this sheet is short. Empty when every kit on the order is
 * accounted for — the overwhelmingly common case, and the one that must
 * stay a single tap.
 */
export function kitShortfalls(
  expectations: KitExpectation[],
  counted: CountedQuantities,
): KitShortfall[] {
  const out: KitShortfall[] = []
  for (const e of expectations) {
    const parentQty = sum(e.parentLineIds, counted)
    // Nothing of the parent is going out, so nothing is owed. A kit's
    // minQty is a floor on a kit that exists, not a reason to load
    // accessories for gear nobody rented.
    if (parentQty <= 0) continue

    const expected = resolveKitQuantity(e.ratio, parentQty)
    if (expected <= 0) continue

    const countedQty = sum(e.pieceLineIds, counted)
    if (countedQty >= expected) continue

    out.push({
      key: e.key,
      pieceItemId: e.pieceItemId,
      pieceDescription: e.pieceDescription,
      expected,
      counted: countedQty,
      parentQty,
      parentNames: e.parentNames,
      missingFromOrder: e.pieceLineIds.length === 0,
    })
  }
  return out
}

/** "12 × Motorola CP200 UHF Radio (Digital)" — the parent side, in words. */
export function describeParents(s: Pick<KitShortfall, 'parentQty' | 'parentNames'>): string {
  if (s.parentNames.length === 1) return `${s.parentQty} × ${s.parentNames[0]}`
  return `${s.parentQty} units across ${s.parentNames.length} items`
}

/**
 * One shortfall in one line, in the words a supervisor holding the sheet
 * would use. Says the number that is wrong first — that is what they
 * check against the paper.
 */
export function describeShortfall(s: KitShortfall): string {
  const head = `${s.counted} of ${s.expected} ${s.pieceDescription}`
  const why = `going out with ${describeParents(s)}`
  return s.missingFromOrder
    ? `${head} — ${why}, and it is not on the order at all`
    : `${head} — ${why}`
}
