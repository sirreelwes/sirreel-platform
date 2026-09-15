/**
 * The record of every vehicle walk-around that has been filed.
 *
 * Wes, 2026-09-14: "for vehicle check in and check out forms, they need
 * to be able to go back and see previous check in check out forms.
 * Essentially a history."
 *
 * /reports/vehicles is a WORK QUEUE — two days back, six forward — so a
 * truck that went out last month is simply not on it, and the only
 * screens that knew about its walk-around were the two capture pages,
 * which say "Inspection already completed" and show nothing that was
 * captured. A photographed truck nobody can look up afterwards settles
 * no argument, which is the entire reason the walk-around slots exist
 * (src/lib/fleet/photoPositions.ts).
 *
 * So this is the same second read the order sheets got the same day
 * (listFiledReports in lib/orders/checkReports): unbounded, newest
 * first, with a text filter, feeding a READ-ONLY view. Nothing here
 * writes, and nothing here links to a capture form — re-opening a
 * walk-around is a different act from looking one up.
 *
 * Keyed on the INSPECTION, not the assignment. `Inspection.
 * bookingAssignmentId` is nullable (a ROUTINE or INCIDENT check has no
 * rental behind it, and a few historical rows carry none), and one
 * assignment holds both ends of the arc — so the inspection id is the
 * only thing that names exactly one filed form.
 */

import type { InspectionType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { positionsFor, LEGACY_POSITIONS, DAMAGE_POSITION, positionLabel, type PhotoPosition } from '@/lib/fleet/photoPositions'
import { inspectorDisplayName } from '@/lib/fleet/walkaroundCrew'

/** Which end of the rental a filed form belongs to. */
export type InspectionEdge = 'OUT' | 'IN'

/** CHECKOUT/RETURN are the two ends of a rental; the other two types are
 *  not part of anyone's check in/out, and listing them here would put a
 *  yard-floor maintenance check in the middle of the rental record. */
const EDGE_TYPES: InspectionType[] = ['CHECKOUT', 'RETURN']

export function edgeOf(type: InspectionType): InspectionEdge {
  return type === 'RETURN' ? 'IN' : 'OUT'
}

export interface FiledInspectionRow {
  inspectionId: string
  edge: InspectionEdge
  inspectedAt: Date
  /** Staff name, or the driver's on a blind pickup/drop where nobody
   *  from SirReel was on site. Suffixed so the row says which. */
  inspectorName: string | null
  byDriver: boolean
  unitName: string
  category: string
  jobName: string | null
  company: string | null
  bookingNumber: string | null
  condition: string
  mileage: number | null
  fuelLevel: string | null
  photoCount: number
  /** Damage rows logged on THIS walk-around that were not marked as
   *  already there. What a client would be asked about. */
  newDamageCount: number
}

/** The picked name first — the login is fleet@ for two different people. */
const inspectorOf = inspectorDisplayName

export async function listFiledInspections(
  opts: { q?: string; limit?: number } = {},
): Promise<FiledInspectionRow[]> {
  const q = (opts.q ?? '').trim()
  const take = Math.min(Math.max(1, opts.limit ?? 150), 400)

  // The searchable facts are the ones a supervisor actually has in hand:
  // the unit, the show, the client, the booking number off the paperwork,
  // or the name of whoever walked it around.
  const like = { contains: q, mode: 'insensitive' as const }
  const where = q
    ? {
        type: { in: EDGE_TYPES },
        OR: [
          { asset: { unitName: like } },
          { asset: { category: { name: like } } },
          { bookingAssignment: { bookingItem: { booking: { jobName: like } } } },
          { bookingAssignment: { bookingItem: { booking: { bookingNumber: like } } } },
          { bookingAssignment: { bookingItem: { booking: { company: { name: like } } } } },
          { inspectorName: like },
          { inspectedByUser: { name: like } },
          { inspectedByDriver: { firstName: like } },
          { inspectedByDriver: { lastName: like } },
        ],
      }
    : { type: { in: EDGE_TYPES } }

  const rows = await prisma.inspection.findMany({
    where,
    select: {
      id: true,
      type: true,
      inspectionDate: true,
      overallCondition: true,
      mileageAtInspection: true,
      fuelLevel: true,
      inspectorName: true,
      asset: { select: { unitName: true, category: { select: { name: true } } } },
      inspectedByUser: { select: { name: true } },
      inspectedByDriver: { select: { firstName: true, lastName: true } },
      bookingAssignment: {
        select: {
          bookingItem: {
            select: {
              booking: {
                select: { jobName: true, bookingNumber: true, company: { select: { name: true } } },
              },
            },
          },
        },
      },
      _count: { select: { photos: true } },
      damageItems: { where: { isPreExisting: false }, select: { id: true } },
    },
    orderBy: { inspectionDate: 'desc' },
    take,
  })

  return rows.map((r) => {
    const booking = r.bookingAssignment?.bookingItem.booking ?? null
    const who = inspectorOf(r)
    return {
      inspectionId: r.id,
      edge: edgeOf(r.type),
      inspectedAt: r.inspectionDate,
      inspectorName: who.name,
      byDriver: who.byDriver,
      unitName: r.asset.unitName,
      category: r.asset.category.name,
      jobName: booking?.jobName ?? null,
      company: booking?.company?.name ?? null,
      bookingNumber: booking?.bookingNumber ?? null,
      condition: r.overallCondition,
      mileage: r.mileageAtInspection,
      fuelLevel: r.fuelLevel,
      photoCount: r._count.photos,
      newDamageCount: r.damageItems.length,
    }
  })
}

export interface FiledPhoto {
  id: string
  position: string | null
  takenAt: Date
}

/** One walk-around slot on this form, with the same slot at the OTHER
 *  end of the rental beside it. `theirs` is what makes a photo evidence
 *  rather than a snapshot — the whole point of fixed slots. */
export interface FiledSlot {
  position: string
  label: string
  group: string
  mine: FiledPhoto | null
  theirs: FiledPhoto | null
}

export interface FiledDamage {
  id: string
  location: string
  damageType: string
  severity: string
  notes: string | null
  isPreExisting: boolean
}

export interface FiledInspectionDetail {
  inspectionId: string
  edge: InspectionEdge
  inspectedAt: Date
  inspectorName: string | null
  byDriver: boolean
  unitName: string
  category: string
  makeModel: string | null
  licensePlate: string | null
  assignmentId: string | null
  jobName: string | null
  company: string | null
  bookingNumber: string | null
  /** The rental window this walk-around belongs to, when there is one. */
  startDate: Date | null
  endDate: Date | null
  condition: string
  mileage: number | null
  fuelLevel: string | null
  notes: string | null
  slots: FiledSlot[]
  /** Close-ups, which answer to no slot. */
  damagePhotos: FiledPhoto[]
  /** Photos shot before guided capture existed, or free-form extras.
   *  Rendered as "Other" rather than dropped — they are real evidence. */
  otherPhotos: FiledPhoto[]
  damage: FiledDamage[]
  /** The form at the other end of the same rental, when one is filed. */
  counterpart: {
    inspectionId: string
    edge: InspectionEdge
    inspectedAt: Date
    mileage: number | null
  } | null
  /** Odometer difference across the rental, when both ends recorded one. */
  milesDriven: number | null
}

export async function filedInspection(inspectionId: string): Promise<FiledInspectionDetail | null> {
  const i = await prisma.inspection.findUnique({
    where: { id: inspectionId },
    select: {
      id: true,
      type: true,
      inspectionDate: true,
      overallCondition: true,
      mileageAtInspection: true,
      fuelLevel: true,
      notes: true,
      inspectorName: true,
      bookingAssignmentId: true,
      asset: {
        select: {
          unitName: true,
          make: true,
          model: true,
          licensePlate: true,
          category: { select: { name: true } },
        },
      },
      inspectedByUser: { select: { name: true } },
      inspectedByDriver: { select: { firstName: true, lastName: true } },
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
      bookingAssignment: {
        select: {
          id: true,
          startDate: true,
          endDate: true,
          bookingItem: {
            select: {
              booking: {
                select: { jobName: true, bookingNumber: true, company: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  })
  if (!i) return null

  const edge = edgeOf(i.type)

  // The other end of the same rental. Found through the assignment, which
  // is what ties the two walk-arounds together; an inspection with no
  // assignment has nothing to compare against and says so on screen.
  const other = i.bookingAssignmentId
    ? await prisma.inspection.findFirst({
        where: {
          bookingAssignmentId: i.bookingAssignmentId,
          type: i.type === 'RETURN' ? 'CHECKOUT' : 'RETURN',
        },
        select: {
          id: true,
          type: true,
          inspectionDate: true,
          mileageAtInspection: true,
          photos: { select: { id: true, position: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        },
        orderBy: { inspectionDate: 'desc' },
      })
    : null

  const shape = (p: { id: string; position: string | null; createdAt: Date }): FiledPhoto => ({
    id: p.id,
    position: p.position,
    takenAt: p.createdAt,
  })
  // The NEWEST photo in the slot. The capture screen replaces a re-shot
  // slot, but the handover screen can add a second licence to a filed
  // check-out when the production swaps drivers — the latest is who
  // actually drove off.
  const bySlot = (photos: { id: string; position: string | null; createdAt: Date }[], position: string) => {
    const hits = photos.filter((p) => p.position === position)
    const hit = hits[hits.length - 1]
    return hit ? shape(hit) : null
  }

  // This end's walk-around in Julian's order (no licence on a check-in),
  // then any retired angle that actually holds a photo on either end —
  // those were real shots and render under "Earlier angles".
  const onFile = new Set([...i.photos, ...(other?.photos ?? [])].map((p) => p.position))
  const walk: readonly PhotoPosition[] = [
    ...positionsFor(edge),
    ...LEGACY_POSITIONS.filter((slot) => onFile.has(slot.id)),
  ]
  const slots: FiledSlot[] = walk.map((slot) => ({
    position: slot.id,
    // Julian's wording; the record page sections by group, which is what
    // says which side a "Rear tire" is on.
    label: slot.label,
    group: slot.group,
    mine: bySlot(i.photos, slot.id),
    theirs: other ? bySlot(other.photos, slot.id) : null,
  }))

  const booking = i.bookingAssignment?.bookingItem.booking ?? null
  const who = inspectorOf(i)
  const outMiles = edge === 'OUT' ? i.mileageAtInspection : other?.mileageAtInspection ?? null
  const backMiles = edge === 'IN' ? i.mileageAtInspection : other?.mileageAtInspection ?? null

  return {
    inspectionId: i.id,
    edge,
    inspectedAt: i.inspectionDate,
    inspectorName: who.name,
    byDriver: who.byDriver,
    unitName: i.asset.unitName,
    category: i.asset.category.name,
    makeModel: [i.asset.make, i.asset.model].filter(Boolean).join(' ') || null,
    licensePlate: i.asset.licensePlate,
    assignmentId: i.bookingAssignmentId,
    jobName: booking?.jobName ?? null,
    company: booking?.company?.name ?? null,
    bookingNumber: booking?.bookingNumber ?? null,
    startDate: i.bookingAssignment?.startDate ?? null,
    endDate: i.bookingAssignment?.endDate ?? null,
    condition: i.overallCondition,
    mileage: i.mileageAtInspection,
    fuelLevel: i.fuelLevel,
    notes: i.notes,
    slots,
    damagePhotos: i.photos.filter((p) => p.position === DAMAGE_POSITION).map(shape),
    otherPhotos: i.photos.filter((p) => !p.position).map(shape),
    damage: i.damageItems.map((d) => ({
      id: d.id,
      location: d.locationOnVehicle,
      damageType: d.damageType,
      severity: d.severity,
      notes: d.notes,
      isPreExisting: d.isPreExisting,
    })),
    counterpart: other
      ? {
          inspectionId: other.id,
          edge: edgeOf(other.type),
          inspectedAt: other.inspectionDate,
          mileage: other.mileageAtInspection,
        }
      : null,
    milesDriven: outMiles != null && backMiles != null ? backMiles - outMiles : null,
  }
}

export { positionLabel }
