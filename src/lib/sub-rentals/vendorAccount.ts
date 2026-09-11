/**
 * The partner's ACCOUNT page — every job we have their units on, in one
 * place.
 *
 * Wes 2026-09-05: "Ideally, there will be multiple jobs for the vendor to
 * look at as well as multiple vehicles to choose from. King Kong has dozens
 * of vehicles and potentially we could book multiple of them on one job or
 * across multiple jobs."
 *
 * ── What this is, and what it is not ───────────────────────────────────
 * The per-unit vendor page (/vendor/[token], the conduit) is where a
 * specific booking is worked: location, call time, driver, confirm. That
 * page is one unit on one job, because that is what a driver needs and
 * what a confirmation is about. This page sits above it: one link per
 * PARTNER, listing every show with their gear on it and every unit on each
 * show, each row opening the conduit for that unit. Nothing is worked here;
 * it is the partner's index.
 *
 * Grouped by JOB, because that is how a partner thinks about it — "the
 * EcoFlux shoot needs the two Star Wagons and the honeywagon" — and how a
 * production would ask them about it.
 */

import { randomBytes } from 'crypto'
import type { SubRentalStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { sirreelContactFor, type SirReelContact } from '@/lib/sub-rentals/sirreelContact'
import { unitNameOf } from '@/lib/sub-rentals/conduit'
import { vendorPageUrl } from '@/lib/sub-rentals/conduit'
import { workspaceLinkForVendor, hqLandingPath } from '@/lib/hq-white-label/workspace'
import { PARTNER_HQ_OFFER } from '@/lib/hq-white-label/product'
import { effectiveSharePercent, partnerNet } from '@/lib/sub-rentals/partnerShare'
import type { PartnerKindKey } from '@/lib/sub-rentals/partnerKind'
import { resolvePartnerSection, type PartnerCatalogSectionKey } from '@/lib/site/partnerSections'

export function vendorAccountPath(token: string): string {
  return `/vendor/account/${token}`
}

export function vendorAccountUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
  return `${base}${vendorAccountPath(token)}`
}

/** Mint the partner's account token if they don't have one. Long-lived. */
export async function ensureVendorPortalToken(vendorId: string): Promise<string> {
  const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { portalToken: true } })
  if (!v) throw new Error('vendor not found')
  if (v.portalToken) return v.portalToken
  const token = randomBytes(32).toString('base64url')
  await prisma.vendor.update({
    where: { id: vendorId },
    data: { portalToken: token, portalTokenMintedAt: new Date() },
  })
  return token
}

/** Rotate it — the old link dies immediately. */
export async function rotateVendorPortalToken(vendorId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await prisma.vendor.update({
    where: { id: vendorId },
    data: { portalToken: token, portalTokenMintedAt: new Date() },
  })
  return token
}

export interface VendorAccountUnit {
  subRentalId: string
  unitName: string
  quantity: number
  startDate: string | null
  endDate: string | null
  status: SubRentalStatus
  driverName: string | null
  driverAcked: boolean
  vendorConfirmed: boolean
  vendorDeclined: boolean
  callTime: string | null
  /** The per-unit conduit link, when one has been issued. */
  unitPageUrl: string | null
  alerts: UnitAlert[]
}

export interface VendorAccountJob {
  jobId: string | null
  jobCode: string | null
  jobName: string
  /** Earliest start / latest end across this job's units. */
  startDate: string | null
  endDate: string | null
  units: VendorAccountUnit[]
  /** Count of alerts across the job's units. */
  alertCount: number
}

/** Things the partner still owes on a unit — surfaced as chips. A DELIVERED
 *  unit (a generator, a restroom trailer) asks for a delivery contact, never a
 *  driver, and has no driver acknowledgement to chase. */
export type UnitAlert = 'confirm' | 'driver' | 'delivery-contact' | 'driver-ack' | 'call-time'

export interface VendorAccountFleetUnit {
  id: string
  name: string
  vehicleType: string | null
  /** Where it sits on sirreel.com when listed. */
  section: PartnerCatalogSectionKey
  /** How it normally reaches set; null = decided per booking. */
  receiveMethod: 'PICKUP' | 'DELIVERY' | null
  listed: boolean
  active: boolean
  daily: number | null
  weekly: number | null
  monthly: number | null
  /** A pending proposal from the partner, awaiting HQ. */
  proposed: { daily: number | null; weekly: number | null; monthly: number | null; at: string; note: string | null } | null
  /** What the partner receives per period under the deal (list less SirReel's share). */
  net: { daily: number | null; weekly: number | null; monthly: number | null }
}

export interface VendorAccountAgreement {
  id: string
  title: string
  signedAt: string | null
  signerName: string | null
  expiryDate: string | null
}

export interface VendorAccountView {
  vendorId: string
  vendorName: string
  /** VEHICLES (King Kong) or EQUIPMENT (PowerTrip) — picks the words. */
  kind: PartnerKindKey
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  lotAddress: string | null
  hasLogo: boolean
  /** How many of their units we list for hire. */
  rosterCount: number
  fleet: VendorAccountFleetUnit[]
  agreement: VendorAccountAgreement | null
  /** The deal: SirReel's share of the vehicle rental rate. Null until HQ sets it. */
  sharePercent: number | null
  /** How far SirReel's share may rise when a client gets a discount on their
   *  unit (the discount waterfall). Null = they do not flex. */
  maxSharePercent: number | null
  /** Who at SirReel they call — Vendor.sirreelContactUserId, else Wes. */
  sirreelContact: SirReelContact | null
  current: VendorAccountJob[]
  past: VendorAccountJob[]
  /**
   * The "See what HQ can do for you" strip at the bottom (Wes 2026-09-05).
   * `workspace` is set once they've started one — then the strip opens it.
   */
  hq: {
    landingPath: string | null
    workspace: { url: string; status: string; trialDaysLeft: number | null } | null
  }
}

const PAST: SubRentalStatus[] = ['RETURNED', 'CANCELLED']

function iso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

/**
 * Load the account by token. `stamp` bumps the open counter — the public
 * page passes true; the HQ preview passes false (an HQ look is not the
 * partner opening it).
 */
export async function loadVendorAccount(
  token: string,
  opts: { stamp?: boolean } = {},
): Promise<VendorAccountView | null> {
  if (!token || token.length < 32) return null
  const vendor = await prisma.vendor.findUnique({
    where: { portalToken: token },
    select: { id: true, name: true, contactName: true, email: true, phone: true, lotAddress: true, logoUrl: true, logoSvg: true, isActive: true, partnerSharePercent: true, partnerMaxSharePercent: true, sirreelContactUserId: true, partnerKind: true, catalogSection: true },
  })
  if (!vendor || !vendor.isActive) return null
  if (opts.stamp) {
    prisma.vendor
      .update({ where: { id: vendor.id }, data: { portalViewedAt: new Date(), portalViewCount: { increment: 1 } } })
      .catch(() => {})
  }
  return buildVendorAccount(vendor, token)
}

/** HQ preview by id — same shape, no token needed, never stamps. */
export async function loadVendorAccountById(vendorId: string): Promise<VendorAccountView | null> {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, name: true, contactName: true, email: true, phone: true, lotAddress: true, logoUrl: true, logoSvg: true, isActive: true, partnerSharePercent: true, partnerMaxSharePercent: true, sirreelContactUserId: true, partnerKind: true, catalogSection: true },
  })
  if (!vendor) return null
  return buildVendorAccount(vendor, null)
}

async function buildVendorAccount(vendor: {
  id: string
  name: string
  contactName: string | null
  email: string | null
  phone: string | null
  lotAddress: string | null
  logoUrl: string | null
  logoSvg: string | null
  partnerSharePercent: unknown
  partnerMaxSharePercent: unknown
  sirreelContactUserId: string | null
  partnerKind: PartnerKindKey
  catalogSection: string | null
}, portalToken: string | null): Promise<VendorAccountView> {
  const [rows, rosterCount, fleetRows, agreementRow, hqWorkspace] = await Promise.all([
    prisma.subRental.findMany({
      where: { vendorId: vendor.id },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      take: 300,
      select: {
        id: true,
        itemDescription: true,
        quantity: true,
        startDate: true,
        endDate: true,
        status: true,
        driverName: true,
        driverAckedAt: true,
        vendorConfirmedAt: true,
        vendorDeclinedAt: true,
        callTime: true,
        receiveMethod: true,
        vendorToken: true,
        subcontractedVehicle: { select: { name: true } },
        job: { select: { id: true, jobCode: true, name: true } },
        order: {
          select: {
            orderNumber: true,
            job: { select: { id: true, jobCode: true, name: true } },
          },
        },
      },
    }),
    prisma.subcontractedVehicle.count({ where: { vendorId: vendor.id, offeredToSirReel: true } }),
    prisma.subcontractedVehicle.findMany({
      // Only what they OFFER us — units they keep to themselves in their
      // own HQ workspace (offeredToSirReel false) are not our business.
      where: { vendorId: vendor.id, offeredToSirReel: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true, name: true, vehicleType: true, publiclyListed: true, isActive: true,
        catalogSection: true, defaultReceiveMethod: true,
        listDailyRate: true, listWeeklyRate: true, listMonthlyRate: true, discountPercent: true,
        proposedDailyRate: true, proposedWeeklyRate: true, proposedMonthlyRate: true, rateProposedAt: true, rateProposalNote: true,
      },
    }),
    prisma.vendorAgreement.findFirst({
      where: { vendorId: vendor.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, signedAt: true, signerName: true, expiryDate: true },
    }),
    // Utliiz is not offered to partners (Wes 2026-09-11) — no link, no lookup.
    PARTNER_HQ_OFFER ? workspaceLinkForVendor(vendor.id) : Promise.resolve(null),
  ])
  const num = (d: unknown) => (d == null ? null : Number(d))
  const sharePercent = num(vendor.partnerSharePercent)
  const sirreelContact = await sirreelContactFor(vendor.sirreelContactUserId).catch(() => null)

  const byJob = new Map<string, VendorAccountJob>()
  for (const r of rows) {
    const job = r.job ?? r.order?.job ?? null
    const key = job?.id ?? `order:${r.order?.orderNumber ?? r.id}`
    const entry =
      byJob.get(key) ??
      ({
        jobId: job?.id ?? null,
        jobCode: job?.jobCode ?? null,
        jobName: job?.name || job?.jobCode || (r.order?.orderNumber ? `Order ${r.order.orderNumber}` : 'Booking'),
        startDate: null,
        endDate: null,
        units: [],
        alertCount: 0,
      } satisfies VendorAccountJob)
    const s = iso(r.startDate)
    const e = iso(r.endDate)
    if (s && (!entry.startDate || s < entry.startDate)) entry.startDate = s
    if (e && (!entry.endDate || e > entry.endDate)) entry.endDate = e
    const alerts: UnitAlert[] = []
    const delivered = r.receiveMethod === 'DELIVERY'
    if (r.status === 'REQUESTED' && !r.vendorConfirmedAt && !r.vendorDeclinedAt) alerts.push('confirm')
    // driverName doubles as the delivery contact on a delivered unit (the
    // conduit's delivery-contact card writes the same column).
    if ((r.status === 'REQUESTED' || r.status === 'CONFIRMED') && !r.driverName) alerts.push(delivered ? 'delivery-contact' : 'driver')
    if (!delivered && (r.status === 'CONFIRMED' || r.status === 'PICKED_UP') && r.driverName && !r.driverAckedAt) alerts.push('driver-ack')
    if (r.status === 'CONFIRMED' && !r.callTime) alerts.push('call-time')
    entry.units.push({
      subRentalId: r.id,
      unitName: unitNameOf(r),
      quantity: r.quantity,
      startDate: s,
      endDate: e,
      status: r.status,
      driverName: r.driverName,
      driverAcked: !!r.driverAckedAt,
      vendorConfirmed: !!r.vendorConfirmedAt,
      vendorDeclined: !!r.vendorDeclinedAt,
      callTime: r.callTime,
      unitPageUrl: r.vendorToken ? vendorPageUrl(r.vendorToken) : null,
      alerts,
    })
    entry.alertCount += alerts.length
    byJob.set(key, entry)
  }

  const jobs = [...byJob.values()]
  const current = jobs.filter((j) => j.units.some((u) => !PAST.includes(u.status)))
  const past = jobs.filter((j) => !j.units.some((u) => !PAST.includes(u.status)))

  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    kind: vendor.partnerKind,
    contactName: vendor.contactName,
    contactEmail: vendor.email,
    contactPhone: vendor.phone,
    lotAddress: vendor.lotAddress,
    hasLogo: !!(vendor.logoSvg || vendor.logoUrl),
    rosterCount,
    fleet: fleetRows.map((u) => ({
      id: u.id,
      name: u.name,
      vehicleType: u.vehicleType,
      section: resolvePartnerSection(u, vendor).key,
      receiveMethod: u.defaultReceiveMethod ?? null,
      listed: u.publiclyListed,
      active: u.isActive,
      daily: num(u.listDailyRate),
      weekly: num(u.listWeeklyRate),
      monthly: num(u.listMonthlyRate),
      proposed: u.rateProposedAt
        ? { daily: num(u.proposedDailyRate), weekly: num(u.proposedWeeklyRate), monthly: num(u.proposedMonthlyRate), at: u.rateProposedAt.toISOString(), note: u.rateProposalNote }
        : null,
      net: (() => {
        const pct = effectiveSharePercent(u, vendor)
        return { daily: partnerNet(u.listDailyRate, pct), weekly: partnerNet(u.listWeeklyRate, pct), monthly: partnerNet(u.listMonthlyRate, pct) }
      })(),
    })),
    sharePercent,
    maxSharePercent: num(vendor.partnerMaxSharePercent),
    sirreelContact,
    agreement: agreementRow
      ? { id: agreementRow.id, title: agreementRow.title, signedAt: agreementRow.signedAt?.toISOString() ?? null, signerName: agreementRow.signerName, expiryDate: agreementRow.expiryDate?.toISOString() ?? null }
      : null,
    current,
    past,
    hq: {
      landingPath: PARTNER_HQ_OFFER && portalToken ? hqLandingPath(portalToken) : null,
      workspace: PARTNER_HQ_OFFER ? hqWorkspace : null,
    },
  }
}
