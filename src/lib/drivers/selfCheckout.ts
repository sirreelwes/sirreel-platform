/**
 * Driver self check-out — the blind-pickup walk-around, done by the
 * DRIVER from their own page.
 *
 * Wes, 2026-09-05 (Luis Salgado / Forgotten Island): "On the blind
 * pickup, we want to make the driver take pictures of the vehicle, 4
 * sides, confirm mileage (or take a dashboard pic showing) and check the
 * vehicle out." Nobody from SirReel is on site for an unattended pickup,
 * so the staff walk-around (/fleet/inspection) has nobody to run it.
 * This is the same record — Inspection + CheckoutRecord + the same photo
 * slots from photoPositions — written by the driver's token instead of a
 * staff session, so the return-side check-in has something to compare
 * against and the report reads the same either way.
 *
 * Two things differ from the staff form, on purpose:
 *   - The four sides are REQUIRED, not prompted — but only when nobody
 *     has walked the vehicle around already. See `driverCheckoutDuty`
 *     below; that qualifier is Julian's (2026-09-17) and it is the whole
 *     rule. The staff form is a prompt because a tech must be able to
 *     record what they can see at 6am; the driver's version exists
 *     precisely so that a truck never leaves unattended with NO record.
 *   - Mileage is a typed number OR an odometer photo. Wes's words. The
 *     photo is the stronger record; the number is what the return
 *     compares against, so either is accepted and both are welcome.
 *
 * The licence gate is applied SOFTER than at a staffed handover: the
 * driver must have a licence on file and it must not be expired, but
 * "nobody has checked it yet" does not block — there is nobody awake to
 * check it, and blocking would strand the pickup. The un-checked state is
 * recorded on the CheckoutRecord and called out in the HQ email instead.
 */

import { list } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { evaluateLicenseGate } from '@/lib/drivers/licenseGate'
import { positionById, DAMAGE_POSITION, normalizePosition, type PhotoPosition } from '@/lib/fleet/photoPositions'
import { VALID_FUEL, FUEL_LEVEL_ERROR } from '@/lib/fleet/fuelLevels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { buildDriverSelfCheckoutEmail } from '@/lib/email/templates/driverSelfCheckout'
import { advanceOrdersToOnJob, projectOnJob } from '@/lib/orders/onJobFromVehicleOut'

// From the FULL registry: the flat sides, odometer and fuel gauge are no
// longer in the staff walk-around (Julian's list, 2026-09-15) but drivers
// still shoot them.
const pick = (ids: string[]): PhotoPosition[] => ids.map((id) => positionById(id)!).filter(Boolean)

/** The four sides. Every one must be on file before the driver can check out. */
export const DRIVER_REQUIRED_POSITIONS: readonly PhotoPosition[] = pick([
  'FRONT', 'DRIVER_SIDE', 'REAR', 'PASSENGER_SIDE',
])
/** Odometer is the mileage alternative; fuel and interior are welcome. */
export const DRIVER_OPTIONAL_POSITIONS: readonly PhotoPosition[] = pick([
  'ODOMETER', 'FUEL_GAUGE', 'INTERIOR',
])

const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

export const stagedPrefixFor = (bookingAssignmentId: string) =>
  `fleet-inspections/staged/${bookingAssignmentId}/`

/** What the yard already recorded on this vehicle before the driver arrived. */
export interface WalkaroundOnFile {
  /** A CHECKOUT inspection filed by SIRREEL (not by a driver) exists. */
  onFile: boolean
  /** Its odometer reading, when it recorded one. */
  mileage: number | null
}

export interface CheckoutDuty {
  /** Slots the driver MUST fill before the vehicle is released. */
  required: PhotoPosition[]
  /** Offered, never demanded. */
  optional: PhotoPosition[]
  /** A typed number or an odometer photo is required. */
  mileageRequired: boolean
  /** Why the driver is or isn't being asked — for the page's one line. */
  because: 'walkaround-on-file' | 'nothing-on-file'
}

/**
 * How much the driver is asked to do, given what the yard already did.
 *
 * Julian, 2026-09-17: "we have no need to prompt drivers for checkout
 * photos unless for some reason it is an unplanned pickup." His process
 * checks the vehicle out the DAY BEFORE — the walk-around, the sheet, the
 * photos — so on a planned blind pickup the condition is already on file
 * before the driver is anywhere near the truck, and asking them to shoot
 * four more sides in a dark yard buys nothing. It also costs something
 * real: FRONT and REAR are the same slot on both lists, and the record
 * renders the newest photo per slot, so the driver's pair DISPLACES the
 * yard's on the filed record.
 *
 * "Unplanned" is not a flag anyone sets, and a flag nobody remembers to
 * set is worse than no flag. It is DERIVED from the fact that decides it:
 * whether SirReel walked this vehicle around at all. Nothing on file means
 * nobody got the chance — which IS the unplanned pickup — and there the
 * four sides stay required, because that truck would otherwise leave with
 * no record of its condition in either direction.
 *
 * Mileage follows the same logic: the yard's reading stands for a parked
 * truck overnight, so the driver is not made to re-enter it. With nothing
 * on file they are, exactly as before.
 *
 * Pure — no prisma — so the page, the API and the test share one answer.
 * `npm run test:driver-checkout-duty`.
 */
export function driverCheckoutDuty(walkaround: WalkaroundOnFile): CheckoutDuty {
  if (!walkaround.onFile) {
    return {
      required: [...DRIVER_REQUIRED_POSITIONS],
      optional: [...DRIVER_OPTIONAL_POSITIONS],
      mileageRequired: true,
      because: 'nothing-on-file',
    }
  }
  return {
    // Nothing is demanded, everything is still OFFERED: a driver who sees
    // fresh damage in the yard must always be able to photograph it, and
    // that is the one case where their shot is the valuable one.
    required: [],
    optional: [...DRIVER_REQUIRED_POSITIONS, ...DRIVER_OPTIONAL_POSITIONS],
    mileageRequired: walkaround.mileage == null,
    because: 'walkaround-on-file',
  }
}

export interface SelfCheckoutDone {
  at: string
  mileage: number | null
  fuelLevel: string | null
  photoCount: number
}

export interface SelfCheckoutState {
  /** The page shows the check-out step. */
  enabled: boolean
  /** Why it is not enabled — for the page to explain, not to hide. */
  reason: 'not-unattended' | 'already-done' | 'vehicle-returned' | 'cancelled' | null
  done: SelfCheckoutDone | null
  /** What the driver must photograph / may photograph. */
  required: PhotoPosition[]
  optional: PhotoPosition[]
  /** Whether a mileage number or odometer photo is demanded. */
  mileageRequired: boolean
  /** SirReel already walked this vehicle around — the page says so, and
   *  the driver is asked for nothing but the check-out itself. */
  walkaroundOnFile: boolean
  /** A licence problem the driver has to fix before the button works. */
  licenseBlocker: string | null
  /** Licence is on file but staff have not checked it yet — recorded, not blocking. */
  licenseUnchecked: boolean
}

export function selfCheckoutState(input: {
  driverAssignment: { status: string; pickedUpAt: Date | null; pickupMileage: number | null }
  bookingAssignment: { status: string }
  isBlindPickup: boolean
  driver: Parameters<typeof evaluateLicenseGate>[0]
  done: SelfCheckoutDone | null
  /** What the yard already filed — see driverCheckoutDuty. */
  walkaround: WalkaroundOnFile
}): SelfCheckoutState {
  const gate = evaluateLicenseGate(input.driver)
  const duty = driverCheckoutDuty(input.walkaround)
  const base = {
    required: duty.required,
    optional: duty.optional,
    mileageRequired: duty.mileageRequired,
    walkaroundOnFile: duty.because === 'walkaround-on-file',
    licenseBlocker: gate.code === 'NO_LICENSE' || gate.code === 'EXPIRED' ? driverFacingLicenseMessage(gate.code) : null,
    licenseUnchecked: gate.code === 'NOT_CHECKED',
    done: input.done,
  }
  if (input.driverAssignment.status === 'CANCELLED') return { ...base, enabled: false, reason: 'cancelled' }
  if (input.done || input.driverAssignment.status === 'PICKED_UP') {
    return { ...base, enabled: false, reason: 'already-done' }
  }
  if (input.bookingAssignment.status === 'RETURNED' || input.bookingAssignment.status === 'SWAPPED') {
    return { ...base, enabled: false, reason: 'vehicle-returned' }
  }
  if (!input.isBlindPickup) return { ...base, enabled: false, reason: 'not-unattended' }
  return { ...base, enabled: true, reason: null }
}

function driverFacingLicenseMessage(code: 'NO_LICENSE' | 'EXPIRED'): string {
  return code === 'EXPIRED'
    ? 'The license we have for you has expired. We can’t release the vehicle on it — please call the number below.'
    : 'Upload both sides of your driver’s license above before checking the vehicle out.'
}

export class SelfCheckoutError extends Error {
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

export interface CompleteSelfCheckoutInput {
  driverAssignmentId: string
  mileage: number | null
  fuelLevel: string | null
  damageNoted: boolean
  notes: string | null
  stagedPhotos: StagedPhotoInput[]
}

export interface CompleteSelfCheckoutResult {
  inspectionId: string
  checkoutRecordId: string
  adoptedStaffInspection: boolean
  photosAttached: number
  photosMissing: number
  pickedUpAt: Date
  emailSent: boolean
}

/**
 * The write. Everything is re-validated here from the driver assignment
 * downward — the route hands over a token-resolved id and a body, nothing
 * else is trusted.
 */
export async function completeSelfCheckout(input: CompleteSelfCheckoutInput): Promise<CompleteSelfCheckoutResult> {
  const da = await prisma.driverAssignment.findUnique({
    where: { id: input.driverAssignmentId },
    select: {
      id: true, status: true, expiresAt: true, pickedUpAt: true,
      driver: {
        select: {
          id: true, firstName: true, lastName: true, phone: true, email: true,
          licenseFrontUrl: true, licenseBackUrl: true,
          licenseExpiry: true, licenseExpired: true, licenseVerified: true,
        },
      },
      bookingAssignment: {
        select: {
          id: true, assetId: true, status: true,
          asset: { select: { unitName: true, licensePlate: true, category: { select: { name: true } } } },
          bookingItem: {
            select: {
              booking: {
                select: { id: true, jobId: true, jobName: true, company: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  })
  if (!da) throw new SelfCheckoutError('invalid link', 404)
  if (da.expiresAt && da.expiresAt < new Date()) throw new SelfCheckoutError('This link has expired — ask for a new one.', 410)
  if (da.status === 'CANCELLED') throw new SelfCheckoutError('This driver assignment was cancelled.', 409)
  if (da.status === 'PICKED_UP' || da.pickedUpAt) {
    throw new SelfCheckoutError('This vehicle is already checked out to you.', 409, { alreadyDone: true })
  }
  const asg = da.bookingAssignment
  if (asg.status === 'RETURNED' || asg.status === 'SWAPPED') {
    throw new SelfCheckoutError('This vehicle reservation is no longer active — please call us.', 409)
  }

  const gate = evaluateLicenseGate(da.driver)
  if (gate.code === 'NO_LICENSE' || gate.code === 'EXPIRED') {
    throw new SelfCheckoutError(driverFacingLicenseMessage(gate.code), 409, { license: gate.code })
  }

  if (input.fuelLevel && !VALID_FUEL.has(input.fuelLevel)) {
    throw new SelfCheckoutError(FUEL_LEVEL_ERROR)
  }

  // ── Photos: only keys under this assignment's staging prefix, and only
  //    ones that really exist. The four sides are checked against what is
  //    IN THE STORE, not what the browser claims it uploaded.
  const prefix = stagedPrefixFor(asg.id)
  const requested = input.stagedPhotos
    .filter((p): p is StagedPhotoInput & { key: string } => typeof p?.key === 'string' && p.key.startsWith(prefix))
    .slice(0, 50)
  const { blobs } = requested.length ? await list({ prefix, limit: 1000 }) : { blobs: [] as { pathname: string; url: string; uploadedAt: Date }[] }
  const byPath = new Map(blobs.map((b) => [b.pathname, b]))
  const present = requested
    .map((p) => ({ p, blob: byPath.get(p.key) }))
    .filter((x): x is { p: StagedPhotoInput & { key: string }; blob: { pathname: string; url: string; uploadedAt: Date } } => !!x.blob)
  const photosMissing = requested.length - present.length

  // What SirReel already filed on this vehicle decides how much is asked
  // of the driver (Julian 2026-09-17 — see driverCheckoutDuty). Re-read
  // here rather than trusted from the page: this is the gate that lets a
  // truck leave, so it is settled server-side.
  const priorWalkaround = await prisma.inspection.findFirst({
    where: { bookingAssignmentId: asg.id, type: 'CHECKOUT', inspectedByDriverId: null },
    orderBy: { inspectionDate: 'desc' },
    select: { mileageAtInspection: true },
  })
  const duty = driverCheckoutDuty({
    onFile: !!priorWalkaround,
    mileage: priorWalkaround?.mileageAtInspection ?? null,
  })

  const positionsOnFile = new Set(present.map((x) => normalizePosition(x.p.position)).filter(Boolean) as string[])
  const missingSides = duty.required.filter((s) => !positionsOnFile.has(s.id))
  if (missingSides.length) {
    throw new SelfCheckoutError(
      `Still need a photo of: ${missingSides.map((s) => s.label.toLowerCase()).join(', ')}.`,
      400,
      { missing: missingSides.map((s) => s.id) },
    )
  }
  const hasOdometerPhoto = positionsOnFile.has('ODOMETER')
  const mileage =
    input.mileage != null && Number.isFinite(input.mileage) ? Math.max(0, Math.floor(input.mileage)) : null
  if (duty.mileageRequired && mileage == null && !hasOdometerPhoto) {
    throw new SelfCheckoutError('Type the mileage, or take a photo of the odometer.', 400, { missing: ['ODOMETER'] })
  }

  const now = new Date()
  const notes = [
    duty.because === 'walkaround-on-file'
      ? 'Driver self check-out (unattended pickup) — SirReel had already walked this vehicle around, so no photos were asked of the driver.'
      : 'Driver self check-out (unattended pickup) — nothing was on file beforehand, so the driver shot the four sides.',
    input.damageNoted ? 'Driver reported existing damage — see close-ups.' : null,
    input.notes?.trim() ? input.notes.trim().slice(0, 2000) : null,
    gate.code === 'NOT_CHECKED' ? 'Licence on file but not yet checked by staff at the time of pickup.' : null,
  ].filter(Boolean).join('\n')

  const result = await prisma.$transaction(async (tx) => {
    // A staff walk-around may already exist (the truck was staged the
    // day before). Then the driver's photos are ADDED to that record
    // rather than a second CHECKOUT inspection being minted — one
    // check-out per assignment is what the report and the return
    // screen both assume. Staff numbers are never overwritten.
    const existing = await tx.inspection.findFirst({
      where: { bookingAssignmentId: asg.id, type: 'CHECKOUT' },
      select: { id: true, mileageAtInspection: true },
    })
    const inspection = existing
      ? await tx.inspection.update({
          where: { id: existing.id },
          data: {
            notes: notes,
            mileageAtInspection: existing.mileageAtInspection ?? mileage ?? undefined,
          },
          select: { id: true },
        })
      : await tx.inspection.create({
          data: {
            assetId: asg.assetId,
            bookingAssignmentId: asg.id,
            type: 'CHECKOUT',
            inspectedBy: null,
            inspectedByDriverId: da.driver.id,
            inspectionDate: now,
            // The driver is not asked to grade the truck; they are asked
            // whether they can see damage. That is the honest resolution
            // of a five-point scale from someone who has never seen the
            // vehicle before.
            overallCondition: input.damageNoted ? 'DAMAGED' : 'GOOD',
            mileageAtInspection: mileage,
            fuelLevel: input.fuelLevel || null,
            newDamageFound: false,
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
          // When it landed in the store, not when the form was filed —
          // see the staff routes; the photo stamp reads this column.
          createdAt: blob.uploadedAt,
        })),
      })
    }

    const openRecord = await tx.checkoutRecord.findFirst({
      where: { bookingAssignmentId: asg.id, returnTime: null },
      orderBy: { checkoutTime: 'desc' },
      select: { id: true, driverId: true, mileageOut: true, fuelOut: true, driver: { select: { firstName: true, lastName: true } } },
    })
    // A second driver checking out a truck that is already out is a
    // HANDOFF, not a re-check: the production named a new driver after
    // the first one had the keys (Forgotten Island, 2026-09-07 — Joel
    // took Cube 29 Saturday night, Isaias was named an hour later and
    // checked it out Sunday morning). The latest holder is the driver of
    // record — the reservation card, the return screen and the after-
    // hours assistant all read CheckoutRecord.driverId — and the earlier
    // driver is kept in the notes and the audit row. The OUT mileage and
    // fuel stay the first reading: that is when the truck left.
    const handoffFrom = openRecord?.driverId && openRecord.driverId !== da.driver.id ? openRecord : null
    if (handoffFrom) {
      const prevName = `${handoffFrom.driver?.firstName ?? ''} ${handoffFrom.driver?.lastName ?? ''}`.trim() || 'the previous driver'
      await tx.inspection.update({
        where: { id: inspection.id },
        data: { notes: `${notes}\nHanded off from ${prevName} to ${`${da.driver.firstName} ${da.driver.lastName}`.trim()} on ${now.toISOString()} (driver self check-out).` },
      })
    }
    const checkout = openRecord
      ? await tx.checkoutRecord.update({
          where: { id: openRecord.id },
          data: {
            driverId: da.driver.id,
            selfCheckout: true,
            licenseVerified: gate.ok,
            mileageOut: openRecord.mileageOut ?? mileage ?? undefined,
            fuelOut: openRecord.fuelOut ?? input.fuelLevel ?? undefined,
          },
          select: { id: true },
        })
      : await tx.checkoutRecord.create({
          data: {
            bookingAssignmentId: asg.id,
            assetId: asg.assetId,
            driverId: da.driver.id,
            checkedOutBy: null,
            selfCheckout: true,
            checkoutTime: now,
            mileageOut: mileage,
            fuelOut: input.fuelLevel || null,
            checkoutInspectionId: inspection.id,
            licenseVerified: gate.ok,
          },
          select: { id: true },
        })

    await tx.driverAssignment.update({
      where: { id: da.id },
      data: {
        status: 'PICKED_UP',
        pickedUpAt: now,
        pickupMileage: mileage,
        checkoutInspectionId: inspection.id,
      },
    })
    // The truck is verifiably gone. Nothing else writes CHECKED_OUT today
    // (the staff walk-around leaves the row ASSIGNED because the driver
    // may not have turned up yet); here the driver is the one telling us.
    if (asg.status === 'ASSIGNED') {
      await tx.bookingAssignment.update({ where: { id: asg.id }, data: { status: 'CHECKED_OUT' } })
    }
    // ...and the order it carries is out with it. BOOKED / LOADED_READY
    // → ON_JOB; an un-booked (APPROVED) order is left for "Book it",
    // which lands on ON_JOB itself once the truck is gone.
    const ordersOnJob = await advanceOrdersToOnJob(tx, {
      jobId: asg.bookingItem.booking.jobId,
      bookingId: asg.bookingItem.booking.id,
      bookingAssignmentId: asg.id,
      userId: null,
      source: 'driver-self-checkout',
    })

    await tx.auditLog.create({
      data: {
        userId: null,
        action: 'driver.self_checkout',
        entityType: 'booking_assignment',
        entityId: asg.id,
        newValues: {
          driverAssignmentId: da.id,
          driverId: da.driver.id,
          inspectionId: inspection.id,
          checkoutRecordId: checkout.id,
          adoptedStaffInspection: !!existing,
          handedOffFromDriverId: handoffFrom?.driverId ?? null,
          mileage,
          fuelLevel: input.fuelLevel || null,
          photos: present.length,
          positions: [...positionsOnFile],
          licenseGate: gate.code,
        },
      },
    })

    return { inspectionId: inspection.id, checkoutRecordId: checkout.id, adoptedStaffInspection: !!existing, ordersOnJob }
  })
  await projectOnJob(result.ordersOnJob)

  // ── Tell HQ. Fire-and-forget: the truck has left either way.
  let emailSent = false
  try {
    const to = await channelRecipients('driver-checkouts')
    if (to.length) {
      const booking = asg.bookingItem.booking
      const base = process.env.NEXTAUTH_URL || 'https://hq.sirreel.com'
      const mail = buildDriverSelfCheckoutEmail({
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
        fuelLevel: input.fuelLevel || null,
        photoCount: present.length,
        positions: [...positionsOnFile],
        damageNoted: input.damageNoted,
        notes: input.notes?.trim() || null,
        licenseUnchecked: gate.code === 'NOT_CHECKED',
        jobLink: booking.jobId ? `${base}/jobs/${booking.jobId}#drivers` : null,
        reportLink: `${base}/api/fleet/inspections/report/${asg.id}`,
      })
      const r = await sendAgreementEmail({
        to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        label: 'driver/self-checkout',
      })
      emailSent = r.ok
    }
  } catch (e) {
    console.error('[selfCheckout] HQ notification failed', e)
  }

  const { ordersOnJob: _projected, ...rest } = result
  return { ...rest, photosAttached: present.length, photosMissing, pickedUpAt: now, emailSent }
}

export { DAMAGE_POSITION }
