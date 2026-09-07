/**
 * Driver self return — the blind-return drop, done by the DRIVER from
 * their own page. The mirror of selfCheckout.ts.
 *
 * Wes 2026-09-07 ("do we have a blind return process similar to the
 * blind pickup?" → "build it"). On an unattended return the truck sits in
 * the yard with nothing recorded until someone runs the walk-around the
 * next morning: no photos, no odometer, no timestamp, and nothing to
 * compare against the check-out shots if it came back scraped. This is
 * the driver's side of that record, filed as they drop the keys.
 *
 * What it writes — the SAME rows the yard's return screen writes:
 *   - Inspection (type RETURN) by the driver (`inspectedByDriverId`),
 *     with the four sides + odometer / fuel / interior / damage photos
 *     in the same slots, so the report lays them beside the check-out.
 *   - CheckoutRecord: `selfReturn`, `driverReturnedAt`, `mileageIn`,
 *     `fuelIn`, `returnInspectionId`, `newDamageOnReturn` (from the
 *     driver's own "I can see new damage" tick).
 *
 * What it deliberately does NOT do: it does not set `returnTime`, does not
 * move the BookingAssignment to RETURNED, and does not settle the job.
 * "Returned" keeps meaning "received by SirReel". The yard's walk-around
 * (/fleet/return, POST /api/fleet/inspections/return) ADOPTS the driver's
 * RETURN inspection instead of minting a second, closes the record with
 * `returnedTo`, and settles the job — starting from the driver's evidence
 * rather than from nothing. Dispatch shows the drop on the inbound lane.
 *
 * Mileage is a typed number OR an odometer photo, same as the pickup.
 */

import { list } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { REQUIRED_POSITIONS, DAMAGE_POSITION, normalizePosition, type PhotoPosition } from '@/lib/fleet/photoPositions'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { buildDriverSelfReturnEmail } from '@/lib/email/templates/driverSelfReturn'
import { stagedPrefixFor, VALID_FUEL } from '@/lib/drivers/selfCheckout'

const byId = new Map(REQUIRED_POSITIONS.map((p) => [p.id, p]))
const pick = (ids: string[]): PhotoPosition[] => ids.map((id) => byId.get(id)!).filter(Boolean)

/** The four sides again — the return set has to line up with the check-out set. */
export const RETURN_REQUIRED_POSITIONS: readonly PhotoPosition[] = pick([
  'FRONT', 'DRIVER_SIDE', 'REAR', 'PASSENGER_SIDE',
])
export const RETURN_OPTIONAL_POSITIONS: readonly PhotoPosition[] = pick([
  'ODOMETER', 'FUEL_GAUGE', 'INTERIOR',
])

const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

export interface SelfReturnDone {
  at: string
  mileage: number | null
  fuelLevel: string | null
  photoCount: number
  milesDriven: number | null
  /** The yard has since received it (their walk-around closed the record). */
  receivedByYard: boolean
}

export interface SelfReturnState {
  enabled: boolean
  reason: 'not-unattended' | 'not-picked-up' | 'not-holder' | 'already-done' | 'vehicle-returned' | 'cancelled' | null
  done: SelfReturnDone | null
  required: PhotoPosition[]
  optional: PhotoPosition[]
  /** Out reading, so the page can show miles driven as they type. */
  mileageOut: number | null
}

export function selfReturnState(input: {
  driverAssignment: { status: string; pickedUpAt: Date | null }
  bookingAssignment: { status: string }
  isBlindReturn: boolean
  /** Does the open checkout record name THIS driver (or nobody yet)? */
  holdsIt: boolean
  mileageOut: number | null
  done: SelfReturnDone | null
}): SelfReturnState {
  const base = {
    required: [...RETURN_REQUIRED_POSITIONS],
    optional: [...RETURN_OPTIONAL_POSITIONS],
    done: input.done,
    mileageOut: input.mileageOut,
  }
  if (input.driverAssignment.status === 'CANCELLED') return { ...base, enabled: false, reason: 'cancelled' }
  if (input.done) return { ...base, enabled: false, reason: 'already-done' }
  if (input.driverAssignment.status !== 'PICKED_UP' && !input.driverAssignment.pickedUpAt) {
    return { ...base, enabled: false, reason: 'not-picked-up' }
  }
  if (input.bookingAssignment.status === 'RETURNED' || input.bookingAssignment.status === 'SWAPPED') {
    return { ...base, enabled: false, reason: 'vehicle-returned' }
  }
  if (!input.holdsIt) return { ...base, enabled: false, reason: 'not-holder' }
  if (!input.isBlindReturn) return { ...base, enabled: false, reason: 'not-unattended' }
  return { ...base, enabled: true, reason: null }
}

export class SelfReturnError extends Error {
  constructor(message: string, public status = 400, public extra: Record<string, unknown> = {}) {
    super(message)
  }
}

export interface StagedPhotoInput {
  key?: string
  filename?: string | null
  contentType?: string | null
  position?: string | null
}

export interface CompleteSelfReturnInput {
  driverAssignmentId: string
  mileage: number | null
  fuelLevel: string | null
  damageNoted: boolean
  notes: string | null
  stagedPhotos: StagedPhotoInput[]
}

export interface CompleteSelfReturnResult {
  inspectionId: string
  checkoutRecordId: string | null
  adoptedExistingInspection: boolean
  photosAttached: number
  photosMissing: number
  returnedAt: Date
  milesDriven: number | null
  emailSent: boolean
}

/**
 * The write. Re-validated from the driver assignment downward — the route
 * hands over a token-resolved id and a body, nothing else is trusted.
 */
export async function completeSelfReturn(input: CompleteSelfReturnInput): Promise<CompleteSelfReturnResult> {
  const da = await prisma.driverAssignment.findUnique({
    where: { id: input.driverAssignmentId },
    select: {
      id: true, status: true, expiresAt: true, pickedUpAt: true,
      driver: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
      bookingAssignment: {
        select: {
          id: true, assetId: true, status: true,
          asset: { select: { unitName: true, licensePlate: true, category: { select: { name: true } } } },
          bookingItem: {
            select: {
              booking: { select: { id: true, jobId: true, jobName: true, company: { select: { name: true } } } },
            },
          },
        },
      },
    },
  })
  if (!da) throw new SelfReturnError('invalid link', 404)
  if (da.expiresAt && da.expiresAt < new Date()) throw new SelfReturnError('This link has expired — ask for a new one.', 410)
  if (da.status === 'CANCELLED') throw new SelfReturnError('This driver assignment was cancelled.', 409)
  if (da.status !== 'PICKED_UP' && !da.pickedUpAt) {
    throw new SelfReturnError('This vehicle was never checked out to you, so there is nothing to return.', 409)
  }
  const asg = da.bookingAssignment
  if (asg.status === 'RETURNED' || asg.status === 'SWAPPED') {
    throw new SelfReturnError('SirReel has already received this vehicle.', 409, { alreadyDone: true })
  }

  // The open record says who holds the truck. A driver who handed it off
  // cannot return it; the driver of record can.
  const openRecord = await prisma.checkoutRecord.findFirst({
    where: { bookingAssignmentId: asg.id, returnTime: null },
    orderBy: { checkoutTime: 'desc' },
    select: { id: true, driverId: true, mileageOut: true, driverReturnedAt: true },
  })
  if (openRecord?.driverReturnedAt) {
    throw new SelfReturnError('This vehicle is already marked as returned.', 409, { alreadyDone: true })
  }
  if (openRecord?.driverId && openRecord.driverId !== da.driver.id) {
    throw new SelfReturnError('This vehicle is on another driver’s record now — they need to return it from their own page.', 409)
  }

  if (input.fuelLevel && !VALID_FUEL.has(input.fuelLevel)) {
    throw new SelfReturnError('fuelLevel must be one of full, 3/4, 1/2, 1/4, empty')
  }

  // ── Photos: only keys under this assignment's staging prefix, and only
  //    ones that really exist in the store.
  const prefix = stagedPrefixFor(asg.id)
  const requested = input.stagedPhotos
    .filter((p): p is StagedPhotoInput & { key: string } => typeof p?.key === 'string' && p.key.startsWith(prefix))
    .slice(0, 50)
  const { blobs } = requested.length ? await list({ prefix, limit: 1000 }) : { blobs: [] as { pathname: string; url: string }[] }
  const byPath = new Map(blobs.map((b) => [b.pathname, b]))
  const present = requested
    .map((p) => ({ p, blob: byPath.get(p.key) }))
    .filter((x): x is { p: StagedPhotoInput & { key: string }; blob: { pathname: string; url: string } } => !!x.blob)
  const photosMissing = requested.length - present.length

  const positionsOnFile = new Set(present.map((x) => normalizePosition(x.p.position)).filter(Boolean) as string[])
  const missingSides = RETURN_REQUIRED_POSITIONS.filter((s) => !positionsOnFile.has(s.id))
  if (missingSides.length) {
    throw new SelfReturnError(
      `Still need a photo of: ${missingSides.map((s) => s.label.toLowerCase()).join(', ')}.`,
      400,
      { missing: missingSides.map((s) => s.id) },
    )
  }
  const hasOdometerPhoto = positionsOnFile.has('ODOMETER')
  const mileage =
    input.mileage != null && Number.isFinite(input.mileage) ? Math.max(0, Math.floor(input.mileage)) : null
  if (mileage == null && !hasOdometerPhoto) {
    throw new SelfReturnError('Type the mileage, or take a photo of the odometer.', 400, { missing: ['ODOMETER'] })
  }
  const milesDriven =
    mileage != null && openRecord?.mileageOut != null && mileage >= openRecord.mileageOut
      ? mileage - openRecord.mileageOut
      : null

  const now = new Date()
  const notes = [
    'Driver self return (unattended drop-off).',
    input.damageNoted ? 'Driver reported NEW damage — see close-ups.' : null,
    input.notes?.trim() ? input.notes.trim().slice(0, 2000) : null,
  ].filter(Boolean).join('\n')

  const result = await prisma.$transaction(async (tx) => {
    // A RETURN inspection may already exist (ops logged damage from the
    // order page before the truck was back). Adopt it — one RETURN row per
    // assignment is the rule the yard's own route keeps too.
    const existing = await tx.inspection.findFirst({
      where: { bookingAssignmentId: asg.id, type: 'RETURN' },
      select: { id: true, notes: true, newDamageFound: true },
    })
    const inspection = existing
      ? await tx.inspection.update({
          where: { id: existing.id },
          data: {
            inspectedByDriverId: da.driver.id,
            inspectionDate: now,
            mileageAtInspection: mileage,
            fuelLevel: input.fuelLevel || null,
            newDamageFound: existing.newDamageFound || input.damageNoted,
            notes: existing.notes ? `${existing.notes}\n${notes}` : notes,
          },
          select: { id: true },
        })
      : await tx.inspection.create({
          data: {
            assetId: asg.assetId,
            bookingAssignmentId: asg.id,
            type: 'RETURN',
            inspectedBy: null,
            inspectedByDriverId: da.driver.id,
            inspectionDate: now,
            // Same honest resolution as the pickup: the driver is asked
            // whether they can see new damage, not to grade the truck.
            overallCondition: input.damageNoted ? 'DAMAGED' : 'GOOD',
            mileageAtInspection: mileage,
            fuelLevel: input.fuelLevel || null,
            newDamageFound: input.damageNoted,
            notes,
          },
          select: { id: true },
        })

    if (present.length) {
      await tx.inspectionPhoto.createMany({
        data: present.map(({ p, blob }) => ({
          inspectionId: inspection.id,
          fileUrl: blob.url,
          filename: p.filename?.slice(0, 80) || p.key.split('/').pop() || 'photo',
          contentType: p.contentType && ALLOWED_PHOTO_TYPES.has(p.contentType) ? p.contentType : null,
          position: normalizePosition(p.position),
          uploadedBy: null,
        })),
      })
    }

    // The record stays OPEN (returnTime null) for the yard to close; the
    // driver's readings land on it now so the walk-around starts from them.
    let checkoutRecordId: string | null = null
    if (openRecord) {
      await tx.checkoutRecord.update({
        where: { id: openRecord.id },
        data: {
          selfReturn: true,
          driverReturnedAt: now,
          mileageIn: mileage,
          fuelIn: input.fuelLevel || null,
          returnInspectionId: inspection.id,
          newDamageOnReturn: input.damageNoted,
        },
      })
      checkoutRecordId = openRecord.id
    }

    await tx.auditLog.create({
      data: {
        userId: null,
        action: 'driver.self_return',
        entityType: 'booking_assignment',
        entityId: asg.id,
        newValues: {
          driverAssignmentId: da.id,
          driverId: da.driver.id,
          inspectionId: inspection.id,
          checkoutRecordId,
          adoptedExistingInspection: !!existing,
          mileage,
          milesDriven,
          fuelLevel: input.fuelLevel || null,
          damageNoted: input.damageNoted,
          photos: present.length,
          positions: [...positionsOnFile],
        },
      },
    })

    return { inspectionId: inspection.id, checkoutRecordId, adoptedExistingInspection: !!existing }
  })

  // ── Tell HQ. Fire-and-forget: the truck is in the yard either way.
  let emailSent = false
  try {
    const to = await channelRecipients('driver-returns')
    if (to.length) {
      const booking = asg.bookingItem.booking
      const base = process.env.NEXTAUTH_URL || 'https://hq.sirreel.com'
      const mail = buildDriverSelfReturnEmail({
        driverName: `${da.driver.firstName} ${da.driver.lastName}`.trim() || da.driver.email || 'Driver',
        driverPhone: da.driver.phone,
        driverEmail: da.driver.email,
        unitName: asg.asset.unitName,
        unitDescription: asg.asset.category?.name ?? null,
        licensePlate: asg.asset.licensePlate,
        productionName: booking.jobName,
        companyName: booking.company?.name ?? null,
        at: now,
        mileage,
        mileageOut: openRecord?.mileageOut ?? null,
        milesDriven,
        fuelLevel: input.fuelLevel || null,
        photoCount: present.length,
        positions: [...positionsOnFile],
        damageNoted: input.damageNoted,
        notes: input.notes?.trim() || null,
        jobLink: booking.jobId ? `${base}/jobs/${booking.jobId}#drivers` : null,
        returnScreenLink: `${base}/fleet/return/${asg.id}`,
        reportLink: `${base}/api/fleet/inspections/report/${asg.id}`,
      })
      const r = await sendAgreementEmail({
        to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        label: 'driver/self-return',
      })
      emailSent = r.ok
    }
  } catch (e) {
    console.error('[selfReturn] HQ notification failed', e)
  }

  return { ...result, photosAttached: present.length, photosMissing, returnedAt: now, milesDriven, emailSent }
}

export { DAMAGE_POSITION }
