/**
 * "Potential" sub-rentals — the record created when we quote a partner's unit
 * to a client, before anyone has committed.
 *
 * Wes, 2026-08-28: sending an estimate should tell the vehicle's owner that we
 * have pitched their unit for those dates, and should open a page where the
 * booking lives. That page is the CONDUIT — the two sides of a sub-rental deal
 * coordinate through us and never directly:
 *
 *     client  ──  /unit/[token]    (unit + specs, no rates, no vendor named)
 *     vendor  ──  /vendor/[token]  (unit + dates + state, no client named)
 *
 * Keeping those two views disjoint is the whole point, not a side effect. The
 * client must not learn whose coach it is; the vendor must not learn who the
 * production is. Both loaders below therefore select explicit field lists, and
 * neither can reach the other side's identity.
 *
 * Status: ESTIMATED means quoted, holding nothing. The vendor is told so their
 * calendar isn't pitched twice without their knowledge, but nothing is
 * committed. Client acceptance moves it to REQUESTED, which is the point at
 * which we ask the vendor for driver details.
 */
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { relayAddress } from '@/lib/sub-rentals/driverRelay'
import { logisticsFor, type LogisticsView } from '@/lib/sub-rentals/conduit'
import { isAckStale } from '@/lib/drivers/hoursEntry'
import { listHours, type HoursView } from '@/lib/drivers/hoursStore'

const TOKEN_BYTES = 32

export interface CreatePotentialArgs {
  vehicleId: string
  jobId: string
  /** Inclusive rental window, ISO yyyy-mm-dd. */
  startDate: string
  endDate: string
  createdByUserId: string
}

export interface PotentialCreated {
  subRentalId: string
  vendorToken: string
  vendorEmail: string | null
  vendorName: string
  vehicleName: string
}

/** Parse a yyyy-mm-dd as a plain date (no timezone drift on a @db.Date column). */
function plainDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function createPotentialSubRental(
  args: CreatePotentialArgs,
): Promise<PotentialCreated | { error: string }> {
  const start = plainDate(args.startDate)
  const end = plainDate(args.endDate)
  if (!start || !end) return { error: 'Start and end dates are required (yyyy-mm-dd).' }
  if (end < start) return { error: 'End date cannot be before the start date.' }

  const vehicle = await prisma.subcontractedVehicle.findUnique({
    where: { id: args.vehicleId },
    select: {
      id: true,
      name: true,
      listDailyRate: true,
      listWeeklyRate: true,
      vendor: { select: { id: true, name: true, email: true, poEmail: true } },
    },
  })
  if (!vehicle) return { error: 'vehicle not found' }

  const job = await prisma.job.findUnique({ where: { id: args.jobId }, select: { id: true } })
  if (!job) return { error: 'job not found' }

  const vendorToken = randomBytes(TOKEN_BYTES).toString('hex')

  const sub = await prisma.subRental.create({
    data: {
      jobId: job.id,
      subcontractedVehicleId: vehicle.id,
      vendorId: vehicle.vendor.id,
      status: 'ESTIMATED',
      itemDescription: vehicle.name,
      quantity: 1,
      startDate: start,
      endDate: end,
      // The client was quoted LIST, so that is the client-side number here.
      // Vendor-side cost is deliberately NOT derived at quote time: the
      // discount can be renegotiated before anything is committed, and a
      // stale vendorTotal on a speculative row would be worse than none.
      clientDailyRate: vehicle.listDailyRate,
      clientWeeklyRate: vehicle.listWeeklyRate,
      vendorToken,
      vendorTokenMintedAt: new Date(),
    },
    select: { id: true },
  })

  await prisma.auditLog.create({
    data: {
      action: 'sub_rental.estimated_created',
      entityType: 'SubRental',
      entityId: sub.id,
      userId: args.createdByUserId,
      newValues: {
        jobId: job.id,
        vehicle: vehicle.name,
        vendor: vehicle.vendor.name,
        startDate: args.startDate,
        endDate: args.endDate,
      },
    },
  })

  return {
    subRentalId: sub.id,
    vendorToken,
    // poEmail is where ordering goes when the vendor keeps a separate desk.
    vendorEmail: vehicle.vendor.poEmail ?? vehicle.vendor.email,
    vendorName: vehicle.vendor.name,
    vehicleName: vehicle.name,
  }
}

export interface VendorView {
  id: string
  status: string
  vehicleName: string
  vehicleType: string | null
  specs: string[]
  startDate: Date | null
  endDate: Date | null
  quantity: number
  /** Our job code — the one reference both sides share. Never the job name. */
  reference: string | null
  photos: { id: string }[]
  driverName: string | null
  driverEmail: string | null
  driverPhone: string | null
  relayAddress: string | null
  /** The driver has been sent their own page (token minted). */
  driverPageSent: boolean
  driverViewedAt: Date | null
  driverAck: { at: Date; note: string | null; stale: boolean } | null
  /** Where and when, as the production set it. See conduit.ts for the ruling. */
  logistics: LogisticsView
  hours: HoursView
  vendorConfirmedAt: Date | null
  vendorDeclinedAt: Date | null
  vendorDeclineNote: string | null
}

/**
 * The vendor's page data. Loads NO production identity: the job's name,
 * company and contacts are not selected — and since 2026-09-05 the job's
 * report-to fields ARE (Wes: the partner and their driver see the location
 * and call time). The on-site contact's phone stays out; see conduit.ts.
 */
export async function getVendorViewByToken(
  token: string,
  opts: { /** False for a STAFF preview — an HQ look must not count as the vendor opening it. */ stamp?: boolean } = {},
): Promise<VendorView | null> {
  if (!token || token.length < 32) return null
  const s = await prisma.subRental.findFirst({
    where: { vendorToken: token },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      quantity: true,
      itemDescription: true,
      driverName: true,
      driverEmail: true,
      driverPhone: true,
      driverToken: true,
      driverViewedAt: true,
      driverAckedAt: true,
      driverAckNote: true,
      relayTag: true,
      callTime: true,
      driverNotes: true,
      logisticsUpdatedAt: true,
      vendorConfirmedAt: true,
      vendorDeclinedAt: true,
      vendorDeclineNote: true,
      job: {
        select: {
          jobCode: true,
          reportToAddress: true,
          reportToAccessNotes: true,
          reportToTime: true,
          reportToContactName: true,
          reportToUpdatedAt: true,
          pickupSameAsDelivery: true,
          pickupAddress: true,
          pickupAccessNotes: true,
          pickupTime: true,
        },
      },
      subcontractedVehicle: {
        select: {
          name: true,
          vehicleType: true,
          specs: true,
          photos: {
            select: { id: true },
            orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
  })
  // The vendor opened their page: stamp it so the Portals tab can say so
  // (Wes 2026-09-05). Fire-and-forget — a failed counter must never 404
  // the vendor's view.
  if (s && opts.stamp !== false) {
    prisma.subRental
      .update({
        where: { id: s.id },
        data: { vendorViewedAt: new Date(), vendorViewCount: { increment: 1 } },
      })
      .catch(() => {})
  }
  if (!s) return null

  return {
    id: s.id,
    status: s.status,
    vehicleName: s.subcontractedVehicle?.name ?? s.itemDescription,
    vehicleType: s.subcontractedVehicle?.vehicleType ?? null,
    specs: (s.subcontractedVehicle?.specs ?? '')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean),
    startDate: s.startDate,
    endDate: s.endDate,
    quantity: s.quantity,
    reference: s.job?.jobCode ?? null,
    photos: s.subcontractedVehicle?.photos ?? [],
    driverName: s.driverName,
    driverEmail: s.driverEmail,
    driverPhone: s.driverPhone,
    relayAddress: s.relayTag ? relayAddress(s.relayTag) : null,
    driverPageSent: !!s.driverToken,
    driverViewedAt: s.driverViewedAt,
    driverAck: s.driverAckedAt
      ? { at: s.driverAckedAt, note: s.driverAckNote, stale: isAckStale(s.driverAckedAt, s.logisticsUpdatedAt) }
      : null,
    logistics: logisticsFor(s),
    hours: await listHours({ subRentalId: s.id }),
    vendorConfirmedAt: s.vendorConfirmedAt,
    vendorDeclinedAt: s.vendorDeclinedAt,
    vendorDeclineNote: s.vendorDeclineNote,
  }
}

export async function getVendorPhotoUrl(token: string, photoId: string): Promise<string | null> {
  if (!token || token.length < 32) return null
  const photo = await prisma.subcontractedVehiclePhoto.findFirst({
    where: {
      id: photoId,
      vehicle: { subRentals: { some: { vendorToken: token } } },
    },
    select: { url: true },
  })
  return photo?.url ?? null
}

export function vendorPagePath(token: string): string {
  return `/vendor/${token}`
}
