/**
 * Does this job put a PARTNER's equipment on the client's location?
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * "Entertainment / Rented Equipment" (the entertainment package / equipment
 * floater) has always been an ALERT check — worth asking for, never enough to
 * hold anything at the gate. That tiering is right for SirReel-owned gear: if
 * a client's certificate is thin on rented-equipment coverage and they wreck
 * our own light kit, we are arguing with our own insurer about our own asset.
 *
 * It is wrong the moment the asset belongs to a partner. The Partner Equipment
 * Agreement §4 tells PowerTrip, in writing, that "the SirReel Rental Agreement
 * requires every production to carry commercial general liability insurance
 * and rented-equipment (inland marine) coverage … Because your Unit is
 * Equipment during the booking, that coverage and indemnity extend to it."
 * That sentence IS the chain. If the certificate does not actually carry the
 * coverage, the chain has one link and it is SirReel: §5 of the same agreement
 * caps SirReel's exposure at the Unit's actual cash value, which is a cap on a
 * bill SirReel is still paying out of pocket for a generator it does not own.
 *
 * So on a job carrying an EQUIPMENT partner's unit, the check is promoted to
 * CRITICAL — the same shape as the auto checks, which are scoped the other
 * direction (src/lib/coi/vehicleScope.ts drops them when no truck is on the
 * job). Same idea in both files: the requirement follows what is actually
 * going out, not a flag someone set once.
 *
 * ── Why EQUIPMENT partners and not all of them ──────────────────────────────
 * A VEHICLES partner's truck is already covered by the auto checks, which are
 * critical whenever a vehicle is on the job — including a partner's, which
 * vehicleScope counts explicitly. Promoting the equipment floater for a King
 * Kong motorhome too would ask a client's broker for a second endorsement that
 * the auto checks already cover, which is the exact goodwill vehicleScope was
 * written to stop spending.
 *
 * ── Computed, never stored ──────────────────────────────────────────────────
 * Derived on READ, like insuredMatch and vehicleScope. Adding a PowerTrip
 * generator to a job re-imposes the requirement on the next read; cancelling
 * the sub-rental lifts it. Callers who cannot see the job pass nothing and get
 * `null`, which leaves the check where it has always been — an alert. Unknown
 * must not silently harden a check into a blocker on jobs that have no partner
 * equipment anywhere near them.
 */

/** Structural, not Prisma types — callers select only what they already load. */
export interface PartnerEquipmentScopeInput {
  subRentals?: ReadonlyArray<{
    status?: string | null
    vendor?: { partnerKind?: string | null; name?: string | null } | null
  }> | null
}

export interface PartnerEquipmentScope {
  /** null = the caller could not see the job. Treat as "no promotion". */
  hasPartnerEquipment: boolean | null
  /** Whose, so a reviewer reads a reason instead of an assertion. */
  reasons: string[]
}

/** A sub-rental in one of these is not going out on this job. */
const DEAD_SUB_RENTAL_STATUSES = new Set(['CANCELLED'])

export function derivePartnerEquipmentScope(
  input: PartnerEquipmentScopeInput,
): PartnerEquipmentScope {
  if (!input.subRentals) return { hasPartnerEquipment: null, reasons: [] }

  const reasons: string[] = []
  for (const sub of input.subRentals) {
    if (sub.status && DEAD_SUB_RENTAL_STATUSES.has(sub.status)) continue
    if (sub.vendor?.partnerKind !== 'EQUIPMENT') continue
    reasons.push(
      sub.vendor?.name
        ? `${sub.vendor.name} equipment sub-rented onto this job`
        : 'partner equipment sub-rented onto this job',
    )
  }

  return { hasPartnerEquipment: reasons.length > 0, reasons: Array.from(new Set(reasons)) }
}

/**
 * The Prisma select that answers the question. Kept beside the deriver so a
 * new caller cannot half-load it and get a confident "no partner equipment"
 * out of a query that never joined the vendor.
 */
export const PARTNER_EQUIPMENT_SCOPE_SELECT = {
  subRentals: {
    select: {
      status: true,
      vendor: { select: { partnerKind: true, name: true } },
    },
  },
} as const
