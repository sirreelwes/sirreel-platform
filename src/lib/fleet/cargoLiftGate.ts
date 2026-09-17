/**
 * Cargo 20–25 have no lift gate (Wes, 2026-09-16) — the RULES.
 *
 * The six vans were seeded into "Cargo Van w/ Liftgate" in March (seed_fleet.ts)
 * and Planyo's "Cargo Vans w/o Liftgate" filing of them was overruled on
 * 2026-07-15 as stale. It was not stale: the vans have no gate. The first
 * attempt to fix it ADDED a second "Cargo 25" to the w/o class and left the
 * original where it was, so one physical van had two rows and the class it
 * was never in still counted it.
 *
 * What "fixed" means, in one place:
 *   · every one of the six is an ACTIVE row in the w/o class — exactly one;
 *   · nothing named Cargo 20–25 is active in the w/ class;
 *   · a duplicate row is FOLDED into the survivor (its history re-pointed,
 *     the row retired), never deleted — a unit's trips are the audit trail.
 *
 * Which row survives when there are two: the ORIGINAL — the active row in
 * the w/ class, oldest first — because it carries the seed id the journals
 * reference, the odometer, the access code, and the trips. The row that was
 * added by mistake is the one that goes. When only the w/o class has active
 * rows the oldest of those is the survivor and the rest fold into it.
 *
 * Pure: no prisma. The DB half is moveCargoOffLiftGate.ts; the test is
 * tests/fleet/cargo-lift-gate.test.ts.
 */

export const CARGO_NO_LIFT_GATE_UNITS: readonly string[] = [
  'Cargo 20', 'Cargo 21', 'Cargo 22', 'Cargo 23', 'Cargo 24', 'Cargo 25',
]

export type CargoClass = 'WITH' | 'WITHOUT'

/**
 * Which cargo-van class a category name is. Matches every spelling the
 * catalog, Planyo and the public site have used ("Cargo Van w/ Liftgate",
 * "Cargo Vans w/o Liftgate", "Cargo w/Lift Gate", "Cargo Van without lift
 * gate"). A plain "Cargo Van" says nothing about a gate and is null: the
 * task must not guess which class an unlabelled row is.
 */
export function cargoClassOf(name: string | null | undefined): CargoClass | null {
  const n = (name ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!n.includes('cargo')) return null
  if (/\bw\/o\b|\bwithout\b|\bno lift/.test(n)) return 'WITHOUT'
  if (/\bw\/\s*lift|\bwith lift|\blift ?gate\b/.test(n)) return 'WITH'
  return null
}

export interface CargoAssetRow {
  id: string
  unitName: string
  cls: CargoClass
  isActive: boolean
  createdAt: Date
}

export type CargoUnitAction =
  /** One active row, in the w/ class: re-file it. */
  | 'move'
  /** The original is in the w/ class and duplicates exist: fold, then re-file. */
  | 'merge-and-move'
  /** Nothing active in the w/ class, more than one active row in w/o: fold. */
  | 'merge'
  /** Exactly one active row, already in w/o. Nothing to do. */
  | 'in-place'
  /** No active row anywhere. Reported, never invented. */
  | 'missing'

export interface CargoUnitPlan {
  unitName: string
  action: CargoUnitAction
  /** The row that ends up being the unit. Null only for 'missing'. */
  keep: CargoAssetRow | null
  /** Active duplicates folded into `keep`, retired afterwards. */
  fold: CargoAssetRow[]
  /** Inactive rows carrying the name. Left alone — already retired. */
  inactive: CargoAssetRow[]
}

const byAge = (a: CargoAssetRow, b: CargoAssetRow) =>
  a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)

/**
 * The plan for every unit in CARGO_NO_LIFT_GATE_UNITS, from every asset row
 * carrying one of those names in either cargo class. Rows in any other
 * category are not this task's to touch and must not be passed in.
 */
export function planCargoMoves(rows: readonly CargoAssetRow[]): CargoUnitPlan[] {
  return CARGO_NO_LIFT_GATE_UNITS.map((unitName) => {
    const mine = rows.filter((r) => r.unitName === unitName)
    const inactive = mine.filter((r) => !r.isActive).sort(byAge)
    const active = mine.filter((r) => r.isActive)
    const inWith = active.filter((r) => r.cls === 'WITH').sort(byAge)
    const inWithout = active.filter((r) => r.cls === 'WITHOUT').sort(byAge)

    if (active.length === 0) {
      return { unitName, action: 'missing', keep: null, fold: [], inactive }
    }
    if (inWith.length > 0) {
      const keep = inWith[0]
      const fold = [...inWith.slice(1), ...inWithout]
      return { unitName, action: fold.length ? 'merge-and-move' : 'move', keep, fold, inactive }
    }
    const keep = inWithout[0]
    const fold = inWithout.slice(1)
    return { unitName, action: fold.length ? 'merge' : 'in-place', keep, fold, inactive }
  })
}

/** The name a folded duplicate is left under, so the Inactive view says
 *  what it is instead of showing a second "Cargo 25" that was retired. */
export function foldedUnitName(unitName: string, on: Date): string {
  return `${unitName} (duplicate — folded ${on.toISOString().slice(0, 10)})`
}

/** Vehicle facts a duplicate may carry that the survivor lacks. */
export const FILLABLE_ASSET_FIELDS = [
  'vin', 'licensePlate', 'year', 'make', 'model', 'accessCode',
  'purchasePrice', 'currentValue', 'insurancePolicyNum', 'insuranceCardUrl',
  'registrationUrl', 'registrationExpiresAt', 'bitCertificateUrl', 'bitCertificateExpiresAt',
  'rentalworksAssetId', 'damageIdRef', 'equipmentTier',
] as const
export type FillableAssetField = (typeof FILLABLE_ASSET_FIELDS)[number]

export type AssetFacts = Partial<Record<FillableAssetField, unknown>> & {
  mileage?: number | null
  notes?: string | null
}

/**
 * What to write on the survivor when a duplicate folds into it: a fact the
 * survivor is missing and the duplicate has; the HIGHER odometer (it only
 * goes up); the duplicate's notes appended once. Never overwrites a value
 * the survivor already carries — the survivor is the row people edited.
 */
export function fillFromDuplicate(keep: AssetFacts, dup: AssetFacts): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of FILLABLE_ASSET_FIELDS) {
    const have = keep[f]
    const theirs = dup[f]
    const empty = have === null || have === undefined || have === ''
    const present = !(theirs === null || theirs === undefined || theirs === '')
    if (empty && present) out[f] = theirs
  }
  const km = typeof keep.mileage === 'number' ? keep.mileage : null
  const dm = typeof dup.mileage === 'number' ? dup.mileage : null
  if (dm !== null && (km === null || dm > km)) out.mileage = dm
  const dn = (dup.notes ?? '').trim()
  const kn = (keep.notes ?? '').trim()
  if (dn && !kn.includes(dn)) out.notes = kn ? `${kn}\n${dn}` : dn
  return out
}

/** The history tables that hang off an Asset — every one a fold re-points.
 *  Mirrors the relation list on `model Asset`; the DB half updates each. */
export const ASSET_HISTORY_RELATIONS = [
  'bookingAssignments', 'checkoutRecords', 'maintenanceRecords', 'dispatchTasks',
  'inspections', 'insuranceClaims', 'incidents', 'lotChecks', 'bitInspections',
] as const
export type AssetHistoryRelation = (typeof ASSET_HISTORY_RELATIONS)[number]
