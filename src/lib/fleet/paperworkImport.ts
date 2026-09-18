/**
 * Reading a FOLDER of DOT paperwork onto the fleet (2026-09-18).
 *
 * Julian keeps the current BIT inspections and vehicle registrations as a
 * folder of scans. The per-unit upload built on 2026-09-17 takes one PDF at a
 * time through a modal you have to open per truck — around 160 documents for
 * the fleet, which is a morning of clicking and therefore a job that does not
 * get done. This is the bulk door: drop the folder, confirm what matched,
 * file it.
 *
 * MATCHING IS PROPOSED, NEVER APPLIED BLIND. Filing Cargo 25's registration
 * onto Cargo 2 is worse than filing nothing — the client downloads a document
 * with the wrong plate and nobody finds out until an officer does. So every
 * rule here is built to REFUSE rather than guess, and the operator sees a row
 * per file with the proposed unit before anything is written.
 *
 * The three refusals that matter:
 *   - a number token must match WHOLE. "Cube 1" must never claim "Cube 10",
 *     and the fleet really does carry both (Cube 1, 10, 12, 13, 18…).
 *   - two units matching one filename is AMBIGUOUS, not a pick. "Cargo 22 and
 *     23.pdf" is one scan of two trucks and a person has to say which.
 *   - a date we cannot read unambiguously is left EMPTY. "03-04-2026" is
 *     March 4th or April 3rd and a BIT date that is a month out moves an
 *     expiry window; the operator types it.
 */

import { parseVehicleDocKind, type VehicleDocKind } from '@/lib/fleet/vehicleDocs'

/** A unit we could file against — the fleet roster, as the picker sees it. */
export interface ImportUnit {
  id: string
  unitName: string
}

export type UnitMatch =
  | { kind: 'one'; unit: ImportUnit }
  | { kind: 'many'; units: ImportUnit[] }
  | { kind: 'none' }

/**
 * Split into comparable tokens: lowercase, separators gone, and — the part
 * that matters — a break at every letter/digit boundary, so `cube27.pdf`,
 * `Cube-27`, `CUBE_27_REG` and `cube 27` all read as ['cube','27'].
 */
export function tokenize(raw: string): string[] {
  return raw
    .replace(/\.[A-Za-z0-9]{1,5}$/, '') // drop the extension
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** Does `needle` appear as a CONTIGUOUS run of whole tokens inside `hay`? */
function containsRun(hay: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true
    for (let j = 0; j < needle.length; j++) {
      // Whole-token equality. A prefix test here is what would let
      // "Cube 1" swallow "Cube 10".
      if (hay[i + j] !== needle[j]) { ok = false; break }
    }
    if (ok) return true
  }
  return false
}

/**
 * Which unit does this filename name? Every unit whose full name appears in
 * the filename is a candidate; more than one is ambiguous and goes to a
 * person.
 *
 * When one candidate's name is a strict superset of another's tokens — a
 * roster carrying both "Cube 27" and "Cube 27 Reefer" — the LONGER name wins
 * rather than reading as ambiguous, since the shorter is just a prefix of the
 * thing actually named.
 */
export function matchUnit(filename: string, units: readonly ImportUnit[]): UnitMatch {
  const hay = tokenize(filename)
  const hits = units.filter((u) => containsRun(hay, tokenize(u.unitName)))
  if (hits.length === 0) return { kind: 'none' }
  if (hits.length === 1) return { kind: 'one', unit: hits[0] }

  const longest = Math.max(...hits.map((u) => tokenize(u.unitName).length))
  const best = hits.filter((u) => tokenize(u.unitName).length === longest)
  // Still tied at the same length → genuinely two trucks named in one name.
  return best.length === 1 ? { kind: 'one', unit: best[0] } : { kind: 'many', units: best }
}

/**
 * Registration or BIT? Read off the filename, and NULL when the words point
 * both ways or neither — the row then asks.
 */
export function guessDocKind(filename: string): VehicleDocKind | null {
  const t = tokenize(filename)
  const has = (...words: string[]) => words.some((w) => t.includes(w))
  const reg = has('reg', 'regis', 'registration', 'registrations', 'dmv', 'tags')
  // "cert" alone is not a BIT — a COI is a certificate too.
  const bit = has('bit', 'inspection', 'inspections', 'biennial', 'terminal')
  if (reg === bit) return null // both, or neither
  return reg ? 'registration' : 'bit-certificate'
}

/** Accepts the kind a caller hands back from the review table. */
export function coerceDocKind(raw: unknown): VehicleDocKind | null {
  return parseVehicleDocKind(raw)
}

/**
 * A date from the filename, or null. Deliberately narrow: only forms that
 * cannot mean two different days.
 *
 *   2026-04-30 / 2026_04_30 / 20260430  → read
 *   04-30-2026                          → read (30 cannot be a month)
 *   03-04-2026                          → NULL, it is two dates in a trench coat
 */
export function findDateInFilename(filename: string): string | null {
  const s = filename.replace(/\.[A-Za-z0-9]{1,5}$/, '')

  const iso = s.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/)
  if (iso) {
    const [, y, m, d] = iso
    if (isRealDate(+y, +m, +d)) return `${y}-${m}-${d}`
  }

  const us = s.match(/(?<!\d)(\d{1,2})[-_./](\d{1,2})[-_./](20\d{2})(?!\d)/)
  if (us) {
    const a = +us[1]
    const b = +us[2]
    const y = +us[3]
    // Only when the second number cannot be a month is the order certain.
    if (b > 12 && isRealDate(y, a, b)) {
      return `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`
    }
    return null
  }
  return null
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

// ── The plan the operator reviews ────────────────────────────────────────

export type RowProblem =
  | 'no-unit'        // nothing in the name looks like a unit on the roster
  | 'many-units'     // more than one truck named
  | 'no-kind'        // cannot tell registration from BIT
  | 'needs-date'     // a BIT with no readable inspection date
  | 'not-pdf'

export interface PlannedRow {
  /** Index into the submitted file list — the join back to the bytes. */
  index: number
  filename: string
  unitId: string | null
  unitName: string | null
  /** Other candidates, when the name matched more than one truck. */
  candidates: ImportUnit[]
  kind: VehicleDocKind | null
  /** BIT only: the inspection date, ISO, when the filename gave one. */
  inspectionDate: string | null
  /**
   * When the document expires, ISO — what feeds the 30-day fleet alert.
   *
   * ALWAYS from the operator, NEVER from the filename. The date in
   * "Cargo 22 BIT 2026-04-30.pdf" is the day it was INSPECTED; reading it as
   * the expiry would file a renewal alert that fires the moment the scan is
   * imported, on every truck at once. Optional by design — a document with no
   * expiry on file is still the document the client needs in the cab, and
   * making it required would put the whole folder back behind data entry.
   */
  expiresAt: string | null
  problems: RowProblem[]
  /** Nothing missing — this row can be filed as it stands. */
  ready: boolean
}

export interface PlanInput {
  filename: string
  isPdf: boolean
  /** Operator corrections from the review table, when re-planning. */
  unitId?: string | null
  kind?: string | null
  inspectionDate?: string | null
  /** What the document expires on — typed, never read off the filename. */
  expiresAt?: string | null
}

/**
 * Turn a dropped folder into a reviewable table. Pure — the route calls it
 * once to propose, and again with the operator's corrections to confirm what
 * it is about to write, so the rules cannot differ between the two passes.
 */
export function planPaperworkImport(files: readonly PlanInput[], units: readonly ImportUnit[]): PlannedRow[] {
  return files.map((f, index) => {
    const problems: RowProblem[] = []

    // An operator's explicit pick always beats the guess.
    let unitId = f.unitId ?? null
    let unitName: string | null = null
    let candidates: ImportUnit[] = []
    if (unitId) {
      unitName = units.find((u) => u.id === unitId)?.unitName ?? null
      if (!unitName) { unitId = null; problems.push('no-unit') }
    } else {
      const m = matchUnit(f.filename, units)
      if (m.kind === 'one') { unitId = m.unit.id; unitName = m.unit.unitName }
      else if (m.kind === 'many') { candidates = m.units; problems.push('many-units') }
      else problems.push('no-unit')
    }

    const kind = coerceDocKind(f.kind) ?? guessDocKind(f.filename)
    if (!kind) problems.push('no-kind')

    const inspectionDate =
      (f.inspectionDate && /^\d{4}-\d{2}-\d{2}$/.test(f.inspectionDate) ? f.inspectionDate : null) ??
      findDateInFilename(f.filename)
    // A BIT row is the only one that cannot be filed without a date — the
    // history is dated, and an undated inspection has nowhere to sit.
    if (kind === 'bit-certificate' && !inspectionDate) problems.push('needs-date')

    if (!f.isPdf) problems.push('not-pdf')

    // No fallback to findDateInFilename on purpose — see PlannedRow.expiresAt.
    const expiresAt = f.expiresAt && /^\d{4}-\d{2}-\d{2}$/.test(f.expiresAt) ? f.expiresAt : null

    return {
      index,
      filename: f.filename,
      unitId,
      unitName,
      candidates,
      kind,
      inspectionDate,
      expiresAt,
      problems,
      ready: problems.length === 0 && !!unitId && !!kind,
    }
  })
}

/** One line for the operator above the table. */
export function planSummary(rows: readonly PlannedRow[]): string {
  const ready = rows.filter((r) => r.ready).length
  const stuck = rows.length - ready
  if (rows.length === 0) return 'No files.'
  if (stuck === 0) return `${ready} file${ready === 1 ? '' : 's'} matched — nothing to fix.`
  return `${ready} of ${rows.length} ready · ${stuck} need${stuck === 1 ? 's' : ''} a look`
}
