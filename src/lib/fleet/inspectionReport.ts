/**
 * The check-out / check-in condition report — the document DamageID
 * emails the renter, assembled from HQ's own inspections.
 *
 * Wes, 2026-09-02: "we don't want to change the process too much. Let's
 * emulate that." DamageID's dispute-prevention mechanism is not the
 * photographs on their own — it is that the renter RECEIVES them, both
 * directions, with the same angles side by side and everything time
 * stamped. Photos nobody outside the yard has seen settle nothing.
 *
 * SENDING IS OFF. Wes asked for the report built and the send path
 * dark until he turns it on (same shape as the Outreach composer):
 * `inspectionReportSendingEnabled()` is the single gate, and it reads an
 * env flag that is set nowhere. Everything below it renders; nothing
 * below it delivers.
 */

import { prisma } from '@/lib/prisma'
import { positionLabel, REQUIRED_POSITIONS, DAMAGE_POSITION } from '@/lib/fleet/photoPositions'

export interface ReportPhoto {
  id: string
  position: string | null
  takenAt: string
}

export interface ReportSide {
  inspectionId: string
  at: string
  inspector: string | null
  condition: string
  fuelLevel: string | null
  mileage: number | null
  notes: string | null
  photos: ReportPhoto[]
  damage: {
    id: string
    location: string
    damageType: string
    severity: string
    notes: string | null
    isPreExisting: boolean
  }[]
}

/** One walk-around slot with both ends of it, for the side-by-side. */
export interface ReportPair {
  position: string
  label: string
  out: ReportPhoto | null
  back: ReportPhoto | null
}

export interface InspectionReport {
  assignmentId: string
  unitName: string
  category: string
  makeModel: string | null
  licensePlate: string | null
  bookingNumber: string
  jobName: string
  company: string
  startDate: string
  endDate: string
  out: ReportSide | null
  back: ReportSide | null
  /** The seven required slots, paired. Always all seven, so a MISSING
   *  shot is visible as missing rather than quietly absent. */
  pairs: ReportPair[]
  /** Close-ups, which have no fixed slot to pair against. */
  damagePhotos: { out: ReportPhoto[]; back: ReportPhoto[] }
  /** Photos with no position — everything shot before guided capture. */
  unpositioned: { out: ReportPhoto[]; back: ReportPhoto[] }
  milesDriven: number | null
  newDamage: ReportSide['damage']
}

const shapePhoto = (p: { id: string; position: string | null; createdAt: Date }): ReportPhoto => ({
  id: p.id,
  position: p.position,
  takenAt: p.createdAt.toISOString(),
})

export async function buildInspectionReport(
  bookingAssignmentId: string,
): Promise<InspectionReport | null> {
  const assignment = await prisma.bookingAssignment.findUnique({
    where: { id: bookingAssignmentId },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      asset: {
        select: {
          unitName: true,
          make: true,
          model: true,
          licensePlate: true,
          category: { select: { name: true } },
        },
      },
      bookingItem: {
        select: {
          booking: {
            select: { bookingNumber: true, jobName: true, company: { select: { name: true } } },
          },
        },
      },
      inspections: {
        where: { type: { in: ['CHECKOUT', 'RETURN'] } },
        select: {
          id: true,
          type: true,
          inspectionDate: true,
          overallCondition: true,
          fuelLevel: true,
          mileageAtInspection: true,
          notes: true,
          inspectedByUser: { select: { name: true } },
          photos: {
            select: { id: true, position: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
          damageItems: {
            select: {
              id: true,
              locationOnVehicle: true,
              damageType: true,
              severity: true,
              notes: true,
              isPreExisting: true,
            },
          },
        },
      },
    },
  })
  if (!assignment) return null

  const side = (type: 'CHECKOUT' | 'RETURN'): ReportSide | null => {
    const i = assignment.inspections.find((x) => x.type === type)
    if (!i) return null
    return {
      inspectionId: i.id,
      at: i.inspectionDate.toISOString(),
      inspector: i.inspectedByUser?.name ?? null,
      condition: i.overallCondition,
      fuelLevel: i.fuelLevel,
      mileage: i.mileageAtInspection,
      notes: i.notes,
      photos: i.photos.map(shapePhoto),
      damage: i.damageItems.map((d) => ({
        id: d.id,
        location: d.locationOnVehicle,
        damageType: d.damageType,
        severity: d.severity,
        notes: d.notes,
        isPreExisting: d.isPreExisting,
      })),
    }
  }

  const out = side('CHECKOUT')
  const back = side('RETURN')

  const bySlot = (s: ReportSide | null, position: string) =>
    s?.photos.find((p) => p.position === position) ?? null

  const pairs: ReportPair[] = REQUIRED_POSITIONS.map((slot) => ({
    position: slot.id,
    label: slot.label,
    out: bySlot(out, slot.id),
    back: bySlot(back, slot.id),
  }))

  const lane = (s: ReportSide | null, pred: (p: ReportPhoto) => boolean) =>
    (s?.photos ?? []).filter(pred)

  return {
    assignmentId: assignment.id,
    unitName: assignment.asset.unitName,
    category: assignment.asset.category.name,
    makeModel: [assignment.asset.make, assignment.asset.model].filter(Boolean).join(' ') || null,
    licensePlate: assignment.asset.licensePlate,
    bookingNumber: assignment.bookingItem.booking.bookingNumber,
    jobName: assignment.bookingItem.booking.jobName,
    company: assignment.bookingItem.booking.company?.name ?? '—',
    startDate: assignment.startDate.toISOString().slice(0, 10),
    endDate: assignment.endDate.toISOString().slice(0, 10),
    out,
    back,
    pairs,
    damagePhotos: {
      out: lane(out, (p) => p.position === DAMAGE_POSITION),
      back: lane(back, (p) => p.position === DAMAGE_POSITION),
    },
    unpositioned: {
      out: lane(out, (p) => !p.position),
      back: lane(back, (p) => !p.position),
    },
    milesDriven:
      out?.mileage != null && back?.mileage != null ? back.mileage - out.mileage : null,
    // What the renter is actually being told about: damage found on the
    // way back. Pre-existing rows are the record that it was ALREADY
    // there, which is the other half of the same argument.
    newDamage: (back?.damage ?? []).filter((d) => !d.isPreExisting),
  }
}

/**
 * The gate. Sending stays off until Wes flips it — he asked for the
 * report built and dark (2026-09-02). Deliberately an env flag rather
 * than a settings row: a client-facing send should not be one stray
 * click in an admin UI away from going live.
 */
export function inspectionReportSendingEnabled(): boolean {
  return process.env.INSPECTION_REPORT_SENDING === 'enabled'
}

export { positionLabel }
