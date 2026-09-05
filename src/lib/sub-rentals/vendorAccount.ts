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
import { unitNameOf } from '@/lib/sub-rentals/conduit'
import { vendorPageUrl } from '@/lib/sub-rentals/conduit'

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
}

export interface VendorAccountJob {
  jobId: string | null
  jobCode: string | null
  jobName: string
  companyName: string | null
  /** Earliest start / latest end across this job's units. */
  startDate: string | null
  endDate: string | null
  units: VendorAccountUnit[]
}

export interface VendorAccountView {
  vendorId: string
  vendorName: string
  contactName: string | null
  lotAddress: string | null
  /** How many of their units we list for hire. */
  rosterCount: number
  current: VendorAccountJob[]
  past: VendorAccountJob[]
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
    select: { id: true, name: true, contactName: true, lotAddress: true, isActive: true },
  })
  if (!vendor || !vendor.isActive) return null
  if (opts.stamp) {
    prisma.vendor
      .update({ where: { id: vendor.id }, data: { portalViewedAt: new Date(), portalViewCount: { increment: 1 } } })
      .catch(() => {})
  }
  return buildVendorAccount(vendor)
}

/** HQ preview by id — same shape, no token needed, never stamps. */
export async function loadVendorAccountById(vendorId: string): Promise<VendorAccountView | null> {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, name: true, contactName: true, lotAddress: true, isActive: true },
  })
  if (!vendor) return null
  return buildVendorAccount(vendor)
}

async function buildVendorAccount(vendor: {
  id: string
  name: string
  contactName: string | null
  lotAddress: string | null
}): Promise<VendorAccountView> {
  const [rows, rosterCount] = await Promise.all([
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
        vendorToken: true,
        subcontractedVehicle: { select: { name: true } },
        job: { select: { id: true, jobCode: true, name: true, company: { select: { name: true } } } },
        order: {
          select: {
            orderNumber: true,
            job: { select: { id: true, jobCode: true, name: true, company: { select: { name: true } } } },
          },
        },
      },
    }),
    prisma.subcontractedVehicle.count({ where: { vendorId: vendor.id } }),
  ])

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
        companyName: job?.company?.name ?? null,
        startDate: null,
        endDate: null,
        units: [],
      } satisfies VendorAccountJob)
    const s = iso(r.startDate)
    const e = iso(r.endDate)
    if (s && (!entry.startDate || s < entry.startDate)) entry.startDate = s
    if (e && (!entry.endDate || e > entry.endDate)) entry.endDate = e
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
    })
    byJob.set(key, entry)
  }

  const jobs = [...byJob.values()]
  const current = jobs.filter((j) => j.units.some((u) => !PAST.includes(u.status)))
  const past = jobs.filter((j) => !j.units.some((u) => !PAST.includes(u.status)))

  return {
    vendorId: vendor.id,
    vendorName: vendor.name,
    contactName: vendor.contactName,
    lotAddress: vendor.lotAddress,
    rosterCount,
    current,
    past,
  }
}
