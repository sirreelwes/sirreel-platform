/**
 * The words a partner surface uses, by what kind of partner it is.
 *
 * King Kong rents us VEHICLES: a driver takes the star wagon to set, logs
 * hours portal to portal, mileage bills from the lot. PowerTrip Rentals
 * (2026-09-10) rents us EQUIPMENT: a generator or a lift is delivered, set
 * up and collected, with a delivery contact rather than a driver. The
 * mechanics differ (driver card vs delivery contact, hours vs none) and so
 * do the words — "your vehicles" reads wrong to a man who rents generators.
 *
 * Plain module (no Prisma import) so client components can read it. The
 * enum values mirror PartnerKind in schema.prisma.
 */

export type PartnerKindKey = 'VEHICLES' | 'EQUIPMENT'

export interface PartnerVocabulary {
  kind: PartnerKindKey
  /** "vehicle" / "unit" */
  one: string
  /** "vehicles" / "equipment" */
  many: string
  /** Capitalised plural for headings. */
  Many: string
  /** "vehicle rental rate" / "rental rate" — the base of the deal. */
  rateNoun: string
  /** Whether bookings normally carry a driver from the partner's roster. */
  drivers: boolean
  /** What we ask the partner for on a booking when there is no driver. */
  onSiteAsk: string
  /** HQ picker label. */
  label: string
  /** HQ picker hint. */
  hint: string
}

const VOCAB: Record<PartnerKindKey, PartnerVocabulary> = {
  VEHICLES: {
    kind: 'VEHICLES',
    one: 'vehicle',
    many: 'vehicles',
    Many: 'Vehicles',
    rateNoun: 'vehicle rental rate',
    drivers: true,
    onSiteAsk: 'the driver',
    label: 'Production vehicles',
    hint: 'Driven to set by a driver from their roster — hours, mileage, call times.',
  },
  EQUIPMENT: {
    kind: 'EQUIPMENT',
    one: 'unit',
    many: 'equipment',
    Many: 'Equipment',
    rateNoun: 'rental rate',
    drivers: false,
    onSiteAsk: 'a delivery contact',
    label: 'Equipment',
    hint: 'Delivered, set up and collected by the partner — generators, distro, HVAC, lifts, lighting.',
  },
}

export const PARTNER_KINDS: readonly PartnerVocabulary[] = [VOCAB.VEHICLES, VOCAB.EQUIPMENT]

export function partnerVocab(kind: string | null | undefined): PartnerVocabulary {
  return VOCAB[(kind ?? 'VEHICLES') as PartnerKindKey] ?? VOCAB.VEHICLES
}

export function isPartnerKind(v: unknown): v is PartnerKindKey {
  return v === 'VEHICLES' || v === 'EQUIPMENT'
}

export type ReceiveMethodKey = 'PICKUP' | 'DELIVERY' | 'WILL_CALL'

export function isReceiveMethod(v: unknown): v is ReceiveMethodKey {
  return v === 'PICKUP' || v === 'DELIVERY' || v === 'WILL_CALL'
}

/**
 * Whether a partner booking involves the PARTNER'S DRIVER. Only PICKUP does
 * (a roster driver takes the unit to set). A delivered unit has a delivery
 * contact; a will-call unit is collected by the production at the partner's
 * lot (Wes 2026-09-15). Null is legacy — rows made before receiveMethod was
 * set on every creation path — and keeps the driver flow it always had.
 */
export function usesPartnerDriver(m: string | null | undefined): boolean {
  return m !== 'DELIVERY' && m !== 'WILL_CALL'
}

/** Labels, HQ-side and partner-side. */
export const RECEIVE_METHOD_LABEL: Record<ReceiveMethodKey, { hq: string; partner: string; short: string }> = {
  PICKUP: { hq: 'Driver takes it (their roster)', partner: 'driven to set', short: 'their driver' },
  DELIVERY: { hq: 'They deliver & collect it', partner: 'you deliver', short: 'they deliver' },
  WILL_CALL: { hq: 'Production picks up at their lot', partner: 'picked up at your lot', short: 'pickup at their lot' },
}

/** The receive method a NEW booking should start with for a unit: the unit's
 *  own, else the partner's default, else by kind. */
export function defaultReceiveMethodFor(
  unit: { defaultReceiveMethod: string | null } | null | undefined,
  vendor: { partnerKind: string | null; defaultReceiveMethod?: string | null } | null | undefined,
): ReceiveMethodKey {
  if (isReceiveMethod(unit?.defaultReceiveMethod)) return unit!.defaultReceiveMethod as ReceiveMethodKey
  if (isReceiveMethod(vendor?.defaultReceiveMethod)) return vendor!.defaultReceiveMethod as ReceiveMethodKey
  return partnerVocab(vendor?.partnerKind).drivers ? 'PICKUP' : 'DELIVERY'
}
