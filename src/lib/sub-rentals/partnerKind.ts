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

/** The receive method a NEW booking should start with for a unit. */
export function defaultReceiveMethodFor(
  unit: { defaultReceiveMethod: string | null } | null | undefined,
  vendor: { partnerKind: string | null } | null | undefined,
): 'PICKUP' | 'DELIVERY' {
  if (unit?.defaultReceiveMethod === 'DELIVERY' || unit?.defaultReceiveMethod === 'PICKUP') return unit.defaultReceiveMethod
  return partnerVocab(vendor?.partnerKind).drivers ? 'PICKUP' : 'DELIVERY'
}
