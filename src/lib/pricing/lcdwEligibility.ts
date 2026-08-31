/**
 * Which vehicles may carry the Limited Collision Damage Waiver.
 *
 * Wes, 2026-08-29: "we need to have the option to add LCDW coverage on
 * all vehicles except Video Vans and PopVans."
 *
 * That is not a new policy — it is the policy the RENTAL AGREEMENT has
 * always stated, which nothing in the system enforced. From
 * src/components/portal-v2/terms.ts (LCDW_ELIGIBILITY_NOTE), signed by
 * every client:
 *
 *   "LCDW is ONLY available for fleet rental vehicles such as: Cube
 *    Trucks, Cargo Vans, Stake Bed Trucks. Specialty Vehicles such as
 *    Motorhomes, Combos, PopVans, VTR/PeopleMover Vans, Restroom
 *    Trailers, Scissor Lifts, Golf Carts or any vehicle requiring a
 *    commercial driver's license are NOT ELIGIBLE for LCDW."
 *
 * So this module is the contract text made executable. If the two ever
 * disagree, the CONTRACT wins and this file is the bug — a waiver we
 * charged for but the agreement excludes is money taken for coverage
 * that does not exist, which is worse than any UI defect.
 *
 * ── Deny by code, not by name ──────────────────────────────────────
 *
 * Matching on description would break the day someone renames "ProScout
 * / VideoVan" — and break silently, in the direction of charging for a
 * waiver the client cannot claim on. Catalog codes are stable and the
 * two exclusions map to exactly one row each.
 */

/** Per-vehicle, per-day. Mirrors the LCDW FeeItem and the addendum. */
export const LCDW_FEE_CODE = 'LCDW'

/**
 * Catalog codes the agreement excludes.
 *
 *   CAT_POPVAN        — PopVan
 *   CAT_PROSCOUT_VTR  — ProScout / VideoVan (the "VTR/PeopleMover Van"
 *                       of the addendum)
 *
 * Add a code here when a new specialty vehicle is catalogued, and update
 * LCDW_ELIGIBILITY_NOTE in the same change so the contract and the
 * system keep saying the same thing.
 */
export const LCDW_EXCLUDED_CODES: ReadonlySet<string> = new Set([
  'CAT_POPVAN',
  'CAT_PROSCOUT_VTR',
  // Wes, 2026-08-31, after the shipped rule offered these three: "exclude
  // the restroom trailer and scissor lift too."
  //
  //   CAT_DLUX         — 2 Unit Restroom Trailer (Sprinter-based)
  //   CAT_DLUX_NORCAL  — the same DLUX product in NORCAL. Excluded with
  //                      its LA twin: one product cannot be coverable in
  //                      one region and not the other, and nobody would
  //                      think to keep the two lists in sync later.
  //   CAT_SCISSOR_LIFT — a lift, not a fleet rental vehicle
  'CAT_DLUX',
  'CAT_DLUX_NORCAL',
  'CAT_SCISSOR_LIFT',
])

/**
 * Deliberately NOT excluded, recorded because the name invites the
 * mistake: Camera Cube. Wes, 2026-08-31 — "Camera Cube is an F550 box
 * truck just like super cube trucks. it can offer LCDW."
 *
 * "Cube" reads like specialty kit, and a future cleanup that judges by
 * name rather than by what the unit IS would drop it. Pinned by a test.
 */

export type LcdwIneligibleReason = 'not-a-vehicle' | 'specialty-vehicle' | 'partner-vehicle'

export interface LcdwCandidate {
  /** OrderLineItem id, for the caller's own bookkeeping. */
  id: string
  description: string
  /** Catalog code of the matched inventory item, when there is one. */
  code: string | null
  department: string
  quantity: number
  billableDays: number | null
  /**
   * True when this line is fulfilled by a partner's vehicle (a
   * SubRental). Wes, 2026-08-29: "partner vehicles not included."
   *
   * We cannot waive damage to a vehicle we do not own. The waiver is
   * SirReel giving up its own claim on its own asset; on a King Kong
   * unit the claim belongs to King Kong, so selling LCDW on it would be
   * selling something we have no standing to give — and the client
   * would only discover that after an accident.
   */
  isPartnerVehicle?: boolean
}

export interface LcdwLineVerdict {
  id: string
  description: string
  eligible: boolean
  reason?: LcdwIneligibleReason
  /** quantity × days — what the waiver would actually be charged on. */
  vehicleDays: number
}

/**
 * Judge one line.
 *
 * A line with no catalog code is treated as eligible when it sits in
 * VEHICLES: a manually-typed "cube truck" is still a cube truck, and
 * refusing coverage because a rep typed instead of picked would deny a
 * waiver the contract grants. The exclusions are specific, catalogued
 * vehicles — an unmatched line is not one of them by definition.
 */
export function judgeLcdwLine(line: LcdwCandidate): LcdwLineVerdict {
  const vehicleDays = Math.max(0, line.quantity) * Math.max(0, line.billableDays ?? 0)

  if (line.department !== 'VEHICLES') {
    return { id: line.id, description: line.description, eligible: false, reason: 'not-a-vehicle', vehicleDays }
  }
  if (line.isPartnerVehicle) {
    return { id: line.id, description: line.description, eligible: false, reason: 'partner-vehicle', vehicleDays }
  }
  if (line.code && LCDW_EXCLUDED_CODES.has(line.code)) {
    return { id: line.id, description: line.description, eligible: false, reason: 'specialty-vehicle', vehicleDays }
  }
  return { id: line.id, description: line.description, eligible: true, vehicleDays }
}

export interface LcdwQuote {
  /** Lines the waiver would cover. */
  eligible: LcdwLineVerdict[]
  /** Vehicle lines the agreement excludes — shown, never silently dropped. */
  excluded: LcdwLineVerdict[]
  /** Σ quantity × days across eligible lines. The billable unit. */
  vehicleDays: number
  /** True when the order has vehicles but every one of them is excluded. */
  allExcluded: boolean
}

/**
 * What LCDW would cost on this order, and on which lines.
 *
 * Excluded vehicles are RETURNED, not filtered away, so the UI can say
 * "covers 2 of 3 vehicles — PopVan is not eligible" instead of quietly
 * charging for less than the client thinks they bought. A client who
 * believes their VideoVan is covered and discovers otherwise at claim
 * time is the failure this whole module exists to prevent.
 */
export function quoteLcdw(lines: LcdwCandidate[]): LcdwQuote {
  const verdicts = lines.map(judgeLcdwLine)
  const vehicleLines = verdicts.filter(
    (v) => v.reason !== 'not-a-vehicle',
  )
  const eligible = vehicleLines.filter((v) => v.eligible)
  const excluded = vehicleLines.filter((v) => !v.eligible)
  return {
    eligible,
    excluded,
    vehicleDays: eligible.reduce((sum, v) => sum + v.vehicleDays, 0),
    allExcluded: vehicleLines.length > 0 && eligible.length === 0,
  }
}

/** One-line summary for the order UI and the agreement. */
export function describeLcdwCoverage(q: LcdwQuote): string {
  if (q.eligible.length === 0 && q.excluded.length === 0) return 'No vehicles on this order.'
  const why = (v: LcdwLineVerdict) =>
    v.reason === 'partner-vehicle' ? 'partner vehicle' : 'specialty vehicle'
  if (q.allExcluded) {
    const parts = q.excluded.map((e) => `${e.description} (${why(e)})`).join(', ')
    return `Not available — ${parts}. LCDW covers SirReel's own fleet vehicles only.`
  }
  const covered = `Covers ${q.eligible.length} vehicle line${q.eligible.length === 1 ? '' : 's'} · ${q.vehicleDays} vehicle-day${q.vehicleDays === 1 ? '' : 's'}`
  if (q.excluded.length === 0) return covered
  return `${covered}. Not covered: ${q.excluded.map((e) => `${e.description} (${why(e)})`).join(', ')}.`
}

/**
 * Can a CATALOG item carry LCDW, before any line exists?
 *
 * Wes, 2026-08-29: the waiver "should be suggested as an option when
 * adding any eligible vehicle … to either the agent or the client who is
 * building an order."
 *
 * Suggesting at the moment of choosing is the only point where the
 * client is actually thinking about that vehicle. Offered later, on a
 * finished quote, it reads as an upsell bolted on at checkout; offered
 * here it reads as part of choosing the truck. It also means a declined
 * waiver is a decision someone made rather than a box nobody saw.
 *
 * `isPartner` covers sub-rental catalog entries — a partner's unit is
 * never eligible, whatever its type, because the claim we would be
 * waiving is not ours to waive.
 */
export function catalogItemSupportsLcdw(item: {
  code?: string | null
  department?: string | null
  isPartner?: boolean
}): boolean {
  if (item.isPartner) return false
  if (item.department !== 'VEHICLES') return false
  if (item.code && LCDW_EXCLUDED_CODES.has(item.code)) return false
  return true
}

/** The one-line offer shown next to an eligible vehicle. */
export function lcdwOfferLabel(perDay: number): string {
  return `Add damage waiver — $${perDay}/day per vehicle`
}
