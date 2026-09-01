/**
 * Was this made in HQ, or imported from somewhere else?
 *
 * Wes, 2026-09-01: "feature most prominently the bookings and orders
 * natively made in HQ. Those imported from RW and Planyo have their own
 * workflows and I am afraid that the natively created ones may sneak up
 * on people or get missed."
 *
 * The fear is arithmetic. Measured the day this shipped:
 *
 *   bookings   258 total — 235 from Planyo (91%), 24 native
 *   live jobs  218 total — 181 from Planyo (83%), 37 native
 *
 * So the work HQ is actually responsible for is one row in six, sorted
 * in among five that somebody else's system is already handling. Nothing
 * on either list said which was which.
 *
 * ── The test is the import anchor, not the source enum ─────────────
 *
 * `planyoCartId` is set by the migration and by nothing else — it is the
 * cart-level idempotency key, so its presence is proof of an import.
 * BookingSource is a weaker signal: PLANYO_BACKFILL marks the May 2026
 * orphan backfill only, and the 2026-08 migration wrote rows whose
 * source is the ordinary AGENT_DIRECT. Reading the enum alone would call
 * 21 imported bookings native.
 *
 * Both are checked, so a row is native only when neither says otherwise.
 */

/** Sources that are, by definition, an import rather than a person. */
const IMPORTED_SOURCES: ReadonlySet<string> = new Set(['PLANYO_BACKFILL'])

export interface ProvenanceInput {
  /** Planyo cart this row was imported from. Set ONLY by the migration. */
  planyoCartId?: string | null
  /** BookingSource, where the row has one. */
  source?: string | null
}

/** True when a human created this in HQ rather than a migration. */
export function isNativeToHq(row: ProvenanceInput): boolean {
  if (row.planyoCartId) return false
  if (row.source && IMPORTED_SOURCES.has(row.source)) return false
  return true
}

export type Origin = 'HQ' | 'PLANYO' | 'RENTALWORKS'

/**
 * Where a JOB came from.
 *
 * `hasRwLink` is a JobRwOrder row — the reconcile link to a RentalWorks
 * order. A job can carry both (a Planyo import later matched to RW); the
 * import wins, because what matters to the reader is that HQ is not the
 * system of record for it.
 */
export function jobOrigin(row: ProvenanceInput & { hasRwLink?: boolean }): Origin {
  if (row.planyoCartId) return 'PLANYO'
  if (row.source && IMPORTED_SOURCES.has(row.source)) return 'PLANYO'
  if (row.hasRwLink) return 'RENTALWORKS'
  return 'HQ'
}

export const ORIGIN_LABEL: Record<Origin, string> = {
  HQ: 'HQ',
  PLANYO: 'Planyo',
  RENTALWORKS: 'RentalWorks',
}

/**
 * Why the reader should care, in one line. Shown on hover — the badge
 * itself is three characters and cannot carry this.
 */
export const ORIGIN_HINT: Record<Origin, string> = {
  HQ: 'Booked in HQ — this one is ours to run. Nothing else is tracking it.',
  PLANYO: 'Imported from Planyo, which the team still works from.',
  RENTALWORKS: 'Matched to a RentalWorks order — billing is handled there.',
}
