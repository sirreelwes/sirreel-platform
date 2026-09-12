/**
 * HQ-printed unit labels — the numbering rule and the label-stock
 * geometry. Pure: no DB, no PDF. `npm run test:unit-labels`.
 *
 * WHY HQ prints labels at all (Oliver, 2026-09-12: "are we going to be
 * producing barcodes for scanning?"): every label on the gear today is a
 * RentalWorks label — RW prints `SR######` when it receives a unit and the
 * nightly sync mirrors it into `InventoryUnit`. RW is being retired, so
 * new gear needs a label RW never issued, and the check-out desk only
 * counts a unit it can scan.
 *
 * THE ONE RULE THAT MATTERS: an HQ number must never be a number RW
 * later issues. RW numbers upward from where it is (SR004674 was on a
 * walkie in 2026-09); HQ takes the block from SR900000 up. Both stay in
 * the `SR` + six digits shape the resolver and every wedge scanner
 * already read, so nothing downstream changes. `nextHqBarcodes` refuses
 * to mint if an RW unit is ever seen inside the HQ block — that would
 * mean the block is not ours any more and someone has to look.
 */

export const BARCODE_RE = /^SR(\d{6})$/
export const HQ_LABEL_FLOOR = 900000
export const HQ_LABEL_CEILING = 999999
/** `InventoryUnit.rwItemId` is required + unique (it is the sync's upsert
 *  key). An HQ-minted unit has no RW id, so it carries this prefix + its
 *  barcode — unique, and no RW ItemId will ever look like it. */
export const HQ_RW_ITEM_PREFIX = 'HQ:'
export const MAX_MINT_PER_BATCH = 100

export function formatBarcode(n: number): string {
  return `SR${String(n).padStart(6, '0')}`
}

export function parseBarcode(code: string): number | null {
  const m = BARCODE_RE.exec(code.trim().toUpperCase())
  return m ? Number(m[1]) : null
}

export function isHqBarcode(code: string): boolean {
  const n = parseBarcode(code)
  return n !== null && n >= HQ_LABEL_FLOOR
}

export type NextBarcodesResult =
  | { ok: true; barcodes: string[] }
  | { ok: false; reason: string }

/**
 * The next `count` HQ numbers, given every barcode already in the
 * register that sits at or above the floor, tagged with where it came
 * from. Refuses (never guesses) when the block holds an RW unit or would
 * run past SR999999.
 */
export function nextHqBarcodes(
  inBlock: Array<{ barcode: string; source: 'RW' | 'HQ' }>,
  count: number,
): NextBarcodesResult {
  if (!Number.isInteger(count) || count < 1) return { ok: false, reason: 'count must be a whole number of 1 or more' }
  if (count > MAX_MINT_PER_BATCH) return { ok: false, reason: `at most ${MAX_MINT_PER_BATCH} labels per batch` }

  const intruder = inBlock.find((u) => u.source === 'RW' && parseBarcode(u.barcode) !== null && parseBarcode(u.barcode)! >= HQ_LABEL_FLOOR)
  if (intruder) {
    return {
      ok: false,
      reason: `RentalWorks has issued ${intruder.barcode}, inside HQ's label block (SR${HQ_LABEL_FLOOR}+). Minting is stopped until someone confirms the block is still ours.`,
    }
  }

  let max = HQ_LABEL_FLOOR - 1
  for (const u of inBlock) {
    const n = parseBarcode(u.barcode)
    if (n !== null && n > max) max = n
  }
  if (max + count > HQ_LABEL_CEILING) {
    return { ok: false, reason: `only ${HQ_LABEL_CEILING - max} numbers left below SR${HQ_LABEL_CEILING}` }
  }
  const barcodes: string[] = []
  for (let i = 1; i <= count; i++) barcodes.push(formatBarcode(max + i))
  return { ok: true, barcodes }
}

// ─────────────────────────────────────────────────────────────────────
// Label stock — Avery-compatible letter sheets, measured in points.
// ─────────────────────────────────────────────────────────────────────

const IN = 72

export interface LabelStock {
  id: LabelStockId
  name: string
  /** Avery part number the sheet is compatible with. */
  compatible: string
  page: { width: number; height: number }
  label: { width: number; height: number }
  cols: number
  rows: number
  /** Top-left of the first label. */
  origin: { x: number; y: number }
  /** Distance between the left edges of neighbouring columns / rows. */
  pitch: { x: number; y: number }
}

export type LabelStockId = 'avery5160' | 'avery5163' | 'avery5167'

/** Sheet geometry per Avery's published templates (letter, portrait). */
export const LABEL_STOCKS: Record<LabelStockId, LabelStock> = {
  avery5160: {
    id: 'avery5160',
    name: 'Address labels · 30 per sheet · 2⅝" × 1"',
    compatible: 'Avery 5160 / 8160',
    page: { width: 8.5 * IN, height: 11 * IN },
    label: { width: 2.625 * IN, height: 1 * IN },
    cols: 3,
    rows: 10,
    origin: { x: 0.1875 * IN, y: 0.5 * IN },
    pitch: { x: 2.75 * IN, y: 1 * IN },
  },
  avery5163: {
    id: 'avery5163',
    name: 'Shipping labels · 10 per sheet · 4" × 2"',
    compatible: 'Avery 5163 / 8163',
    page: { width: 8.5 * IN, height: 11 * IN },
    label: { width: 4 * IN, height: 2 * IN },
    cols: 2,
    rows: 5,
    origin: { x: 0.15625 * IN, y: 0.5 * IN },
    pitch: { x: 4.1875 * IN, y: 2 * IN },
  },
  avery5167: {
    id: 'avery5167',
    name: 'Return-address labels · 80 per sheet · 1¾" × ½"',
    compatible: 'Avery 5167 / 8167',
    page: { width: 8.5 * IN, height: 11 * IN },
    label: { width: 1.75 * IN, height: 0.5 * IN },
    cols: 4,
    rows: 20,
    origin: { x: 0.28125 * IN, y: 0.5 * IN },
    pitch: { x: 2.0625 * IN, y: 0.5 * IN },
  },
}

export const DEFAULT_STOCK: LabelStockId = 'avery5160'

export function isLabelStockId(s: string): s is LabelStockId {
  return s in LABEL_STOCKS
}

export interface LabelCell {
  page: number
  x: number
  y: number
}

/**
 * Where the i-th label lands: `skip` cells are left empty first so a
 * partly used sheet can go back through the printer. Fills across each
 * row, then down.
 */
export function labelCells(stock: LabelStock, count: number, skip = 0): LabelCell[] {
  const perPage = stock.cols * stock.rows
  const s = Math.max(0, Math.min(perPage - 1, Math.floor(skip)))
  const cells: LabelCell[] = []
  for (let i = 0; i < count; i++) {
    const slot = s + i
    const page = Math.floor(slot / perPage)
    const onPage = slot % perPage
    const row = Math.floor(onPage / stock.cols)
    const col = onPage % stock.cols
    cells.push({ page, x: stock.origin.x + col * stock.pitch.x, y: stock.origin.y + row * stock.pitch.y })
  }
  return cells
}

/** Text a scanner receives from a Code 39 label of this unit. */
export function labelText(barcode: string): string {
  return barcode.trim().toUpperCase()
}
