/**
 * "Deliveries" — what is coming TO the client, and who is bringing it.
 *
 * Not to be confused with PortalDriversSection ("Your drivers"), which is the
 * opposite direction: there the client names who is COLLECTING a unit from us.
 * Here we tell them who is DELIVERING one to them. Both live on the same page
 * and must keep their vocabulary apart — "your drivers" vs "arriving".
 *
 * ── What the client may see about a driver ──────────────────────────────────
 * A name, and that a driver exists. Never driverEmail, driverPhone or relayTag.
 *
 * That is not squeamishness, it is the sub-rental conduit: SubRental's own
 * comment says the vendor never learns who the client is and the client never
 * learns whose unit it is, and the driver relay (src/lib/sub-rentals/
 * driverRelay.ts) extends that to the driver — "neither side ever learns the
 * other's address". Handing the client a phone number would break the conduit
 * in one hop AND take the conversation somewhere HQ can't see. So the serializer
 * below is an allowlist, not a filter: it names the fields it emits and a new
 * column on SubRental cannot leak by being added.
 *
 * ── Why sourcing is invisible ───────────────────────────────────────────────
 * A sub-rented coach and one of our own trailers render identically — same
 * shape, same fields, same driver treatment. `vendorName` is never selected
 * here, and `source` is deliberately NOT returned to the client. If the two
 * kinds looked different, the client could tell which unit came from somebody
 * else's yard, which is the exact thing the conduit exists to prevent.
 */
import { prisma } from '@/lib/prisma'
import { isAckStale, sumHours } from '@/lib/drivers/hoursEntry'

/** Client-visible delivery row. Every field here is safe to render. */
export interface DeliveryUnit {
  id: string
  /** "EcoFlux", "DLUX 2" — what the client will see arrive. */
  unitName: string
  /** "Celebrity Motorhome", "2 Unit Restroom Trailer". Null for ad-hoc gear. */
  unitType: string | null
  startDate: string | null
  endDate: string | null
  /** Both dates equal — renders as "back same day" rather than a range. */
  sameDay: boolean
  driver: { name: string; assignedAt: string | null } | null
  /** Delivered by a partner's driver — the production may set a call time
   *  and a note for them here. False for our own fleet drops (dispatch). */
  editable: boolean
  callTime: string | null
  driverNotes: string | null
  /** The driver pressed "I have the location and call time". `stale` when
   *  the plan changed after they did. The note is theirs to the production. */
  driverAck: { at: string; note: string | null; stale: boolean } | null
  /** Hours the driver has logged on their page — total and days. */
  hours: { total: number; days: number }
}

export interface ReportTo {
  address: string | null
  accessNotes: string | null
  /** Free text — "6-7a", "first light", "after wrap". */
  time: string | null
  contactName: string | null
  contactPhone: string | null
  updatedAt: string | null
}

/**
 * The collection half. A trailer we drop has to come back, and the collection
 * is not always where the drop was — a unit moves mid-shoot, or the production
 * strikes to a different lot. `sameAsDelivery` is the common case and the
 * default; when true the address/notes fields are ignored on read and the
 * delivery values stand in.
 */
export interface PickupFrom {
  sameAsDelivery: boolean
  address: string | null
  accessNotes: string | null
  time: string | null
}

export interface DeliveriesPayload {
  units: DeliveryUnit[]
  reportTo: ReportTo
  pickupFrom: PickupFrom
  /** Resolved collection point — pickupFrom when it differs, otherwise the
   *  delivery values. Computed here so no client has to re-derive the
   *  same-as-delivery rule and get it subtly different. */
  effectivePickup: { address: string | null; accessNotes: string | null; time: string | null }
  /** True once any driver on this job has been named — gates the copy that
   *  promises we've passed the address on. */
  anyDriverNamed: boolean
}

const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null)

/**
 * Sub-rental statuses that are no longer coming. RETURNED units stay listed:
 * on delivery day the client still wants to see what arrived and who brought
 * it, and dropping them mid-job would make the section flicker empty.
 */
const GONE = new Set(['CANCELLED'])

/**
 * Everything arriving for a job, newest commitment last.
 *
 * TWO SOURCES, deliberately:
 *
 *  1. Sub-rentals on the job. A partner's unit is always delivered — it comes
 *     off their yard to the client's location, never from ours.
 *
 *  2. Fleet units on orders marked `deliveryRequested`. That flag is the only
 *     honest signal we have for "we bring this one"; without it a unit the
 *     client is collecting themselves would be listed as arriving, and they'd
 *     wait at the gate for a truck that was never coming. The flag is unset on
 *     every order today (0 of 25 at time of writing), so in practice this cut
 *     lists sub-rentals — fleet units appear on their own the moment sales
 *     starts marking delivery, with no further code.
 */
export async function loadDeliveries(jobId: string): Promise<DeliveriesPayload> {
  const [job, subRentals, deliveredOrders] = await Promise.all([
    prisma.job.findUnique({
      where: { id: jobId },
      select: {
        reportToAddress: true,
        reportToAccessNotes: true,
        reportToTime: true,
        reportToContactName: true,
        reportToContactPhone: true,
        reportToUpdatedAt: true,
        pickupSameAsDelivery: true,
        pickupAddress: true,
        pickupAccessNotes: true,
        pickupTime: true,
      },
    }),
    prisma.subRental.findMany({
      where: { jobId },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        itemDescription: true,
        status: true,
        startDate: true,
        endDate: true,
        driverName: true,
        driverAssignedAt: true,
        callTime: true,
        driverNotes: true,
        logisticsUpdatedAt: true,
        driverAckedAt: true,
        driverAckNote: true,
        driverHours: { select: { hours: true } },
        // NOTE: driverEmail / driverPhone / relayTag / driverToken / vendor are
        // NOT selected. Keep it that way — see the header.
        subcontractedVehicle: { select: { vehicleType: true } },
      },
    }),
    prisma.order.findMany({
      where: { jobId, deliveryRequested: true, status: { not: 'CANCELLED' } },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        lineItems: {
          // Only things that ARRIVE. Fees and discounts are money, not
          // objects on a truck, and a child line is a charge belonging to
          // the unit above it — listing either told the client a driver was
          // bringing them a "Mileage".
          where: { type: { notIn: ['FEE', 'DISCOUNT'] }, parentLineItemId: null },
          select: { id: true, description: true, quantity: true },
        },
      },
    }),
  ])

  const units: DeliveryUnit[] = []

  for (const s of subRentals) {
    if (GONE.has(s.status)) continue
    units.push({
      id: `sub:${s.id}`,
      unitName: s.itemDescription,
      unitType: s.subcontractedVehicle?.vehicleType ?? null,
      startDate: ymd(s.startDate),
      endDate: ymd(s.endDate),
      sameDay: !!s.startDate && !!s.endDate && ymd(s.startDate) === ymd(s.endDate),
      driver: s.driverName
        ? { name: s.driverName, assignedAt: s.driverAssignedAt?.toISOString() ?? null }
        : null,
      editable: true,
      callTime: s.callTime,
      driverNotes: s.driverNotes,
      driverAck: s.driverAckedAt
        ? {
            at: s.driverAckedAt.toISOString(),
            note: s.driverAckNote,
            stale: isAckStale(s.driverAckedAt, s.logisticsUpdatedAt),
          }
        : null,
      hours: { total: sumHours(s.driverHours), days: s.driverHours.length },
    })
  }

  // A partner unit reaches us TWICE: once as the sub-rental record and once
  // as the order line that bills it ("EcoFlux" and "EcoFlux — Celebrity
  // Motorhome"). They are one coach, and showing both would have the client
  // expecting two. Match on normalized containment either way round, since
  // the line usually carries the sub-rental's name plus a type suffix.
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const subNames = units.map((u) => norm(u.unitName)).filter(Boolean)
  const duplicatesASubRental = (description: string) => {
    const d = norm(description)
    if (!d) return false
    return subNames.some((n) => d.includes(n) || n.includes(d))
  }

  for (const o of deliveredOrders) {
    for (const li of o.lineItems) {
      if (duplicatesASubRental(li.description)) continue
      units.push({
        id: `line:${li.id}`,
        unitName: li.description,
        unitType: null,
        startDate: ymd(o.startDate),
        endDate: ymd(o.endDate),
        sameDay: !!o.startDate && !!o.endDate && ymd(o.startDate) === ymd(o.endDate),
        // Fleet deliveries route through DispatchTask, which doesn't carry a
        // named driver yet. Renders as the same "not named yet" state a
        // sub-rental shows before the vendor names one — one empty state, not
        // two, so the client never learns the difference.
        driver: null,
        editable: false,
        callTime: null,
        driverNotes: null,
        driverAck: null,
        hours: { total: 0, days: 0 },
      })
    }
  }

  const sameAsDelivery = job?.pickupSameAsDelivery ?? true
  const reportTo: ReportTo = {
    address: job?.reportToAddress ?? null,
    accessNotes: job?.reportToAccessNotes ?? null,
    time: job?.reportToTime ?? null,
    contactName: job?.reportToContactName ?? null,
    contactPhone: job?.reportToContactPhone ?? null,
    updatedAt: job?.reportToUpdatedAt?.toISOString() ?? null,
  }
  const pickupFrom: PickupFrom = {
    sameAsDelivery,
    address: job?.pickupAddress ?? null,
    accessNotes: job?.pickupAccessNotes ?? null,
    time: job?.pickupTime ?? null,
  }

  return {
    units,
    anyDriverNamed: units.some((u) => !!u.driver),
    reportTo,
    pickupFrom,
    effectivePickup: {
      address: sameAsDelivery ? reportTo.address : pickupFrom.address,
      accessNotes: sameAsDelivery ? reportTo.accessNotes : pickupFrom.accessNotes,
      // Time is NEVER inherited. A trailer dropped at 6am is not collected at
      // 6am, so carrying the delivery time over would state a wrong fact
      // rather than leave a blank one.
      time: pickupFrom.time,
    },
  }
}

/** Field caps. Long enough for a real gate note, short enough that the column
 *  can't be used as free storage by anyone who reaches the endpoint. */
export const REPORT_TO_LIMITS = {
  address: 300,
  accessNotes: 1000,
  time: 120,
  contactName: 120,
  contactPhone: 30,
  pickupAddress: 300,
  pickupAccessNotes: 1000,
  pickupTime: 120,
} as const

export interface ReportToInput {
  address?: unknown
  accessNotes?: unknown
  time?: unknown
  contactName?: unknown
  contactPhone?: unknown
  pickupSameAsDelivery?: unknown
  pickupAddress?: unknown
  pickupAccessNotes?: unknown
  pickupTime?: unknown
}

/**
 * Normalize what the browser posted. Empty string clears the field (the client
 * deleting an address must actually delete it, not leave the old one standing),
 * so `null` and `''` both mean "no value" and over-length input is rejected
 * rather than silently truncated — a gate code cut in half is worse than an
 * error.
 */
export function parseReportTo(
  body: ReportToInput,
): { ok: true; data: Record<string, string | null> } | { ok: false; error: string } {
  const out: Record<string, string | null> = {}
  const fields: Array<[keyof typeof REPORT_TO_LIMITS, string, string]> = [
    ['address', 'reportToAddress', 'Delivery address'],
    ['accessNotes', 'reportToAccessNotes', 'Delivery access notes'],
    ['time', 'reportToTime', 'Delivery time'],
    ['contactName', 'reportToContactName', 'On-site contact'],
    ['contactPhone', 'reportToContactPhone', 'Contact phone'],
    ['pickupAddress', 'pickupAddress', 'Pickup address'],
    ['pickupAccessNotes', 'pickupAccessNotes', 'Pickup access notes'],
    ['pickupTime', 'pickupTime', 'Pickup time'],
  ]
  for (const [key, column, label] of fields) {
    const raw = (body as Record<string, unknown>)[key]
    if (raw === undefined) continue
    if (raw !== null && typeof raw !== 'string') {
      return { ok: false, error: `${label} must be text.` }
    }
    const trimmed = (raw ?? '').toString().trim()
    if (trimmed.length > REPORT_TO_LIMITS[key]) {
      return { ok: false, error: `${label} is too long (max ${REPORT_TO_LIMITS[key]} characters).` }
    }
    out[column] = trimmed.length ? trimmed : null
  }

  // The toggle is a boolean, not text, so it sits outside the loop above.
  // Switching BACK to "same as delivery" clears the override rather than
  // leaving a stale second address parked in the columns for dispatch to
  // trip over later.
  if (body.pickupSameAsDelivery !== undefined) {
    const same = !!body.pickupSameAsDelivery
    out.pickupSameAsDelivery = same as unknown as string
    if (same) {
      out.pickupAddress = null
      out.pickupAccessNotes = null
    }
  }
  return { ok: true, data: out }
}
