/**
 * What the production-company portal shows — assembled once, so the page,
 * the API and the "send this to my teams" email all render the SAME
 * account, not three drifting readings of it.
 *
 * ── The editing rule ───────────────────────────────────────────────────
 * Wes 2026-09-04: "This will not feature order detail." An executive is
 * not the PM. They do not want to know which cube truck, or what the
 * per-day rate on a 10-ton was. They want the shape of the account: what
 * shows are running, who is leading each one, what got invoiced and what
 * got signed.
 *
 * So a job tile carries a NAME, DATES, a LEAD CONTACT and a STATE, and the
 * money is the invoiced total — never a line item, never a rate. The
 * detail view adds exactly the two documents the ask named: final invoices
 * and rental agreements. That restraint is the feature; adding order lines
 * here would turn the account view into a second, worse job portal.
 *
 * ── Where the state comes from ─────────────────────────────────────────
 * Not `Job.status` — that column is three human off-ramps (HOLD / WRAPPED
 * / LOST) and nothing writes a lifecycle onto it. The live reading is
 * DERIVED from the orders, the same way the staff /jobs board does it.
 * Here the derivation is coarser than the staff cadence on purpose: an
 * executive needs Upcoming / On the job / Wrapped, not the operational
 * gradations that tell a desk who to chase today.
 */

import type { InvoiceStatus, JobRole, JobStatus, OrderStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { deriveJobDateRange } from '@/lib/jobs/dateRange'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'
import { pickPrimaryContact } from '@/lib/jobs/primaryContact'
import { findCompanyAnnualCoverage, type AnnualCoverage } from '@/lib/orders/annualCoverage'
import { findPendingAnnual, type PendingAnnual } from '@/lib/portal/companyAnnual'

/** Coarse, client-legible job state. */
export type CompanyJobState = 'UPCOMING' | 'ON_JOB' | 'WRAPPED' | 'HOLD' | 'QUOTED'

export const JOB_STATE_LABEL: Record<CompanyJobState, string> = {
  QUOTED: 'Quoted',
  UPCOMING: 'Upcoming',
  ON_JOB: 'On the job',
  WRAPPED: 'Wrapped',
  HOLD: 'On hold',
}

export interface CompanyJobTile {
  id: string
  jobCode: string
  name: string
  state: CompanyJobState
  startDate: string | null
  endDate: string | null
  leadContactName: string | null
  leadContactRole: JobRole | null
  leadContactEmail: string | null
  /** SirReel's agent on the account for this job. */
  repName: string | null
  /** Sum of non-void, issued invoices. Null when nothing has been billed. */
  invoicedTotal: number | null
  balanceDue: number
  orderCount: number
  agreementSigned: boolean
  /**
   * False when the job has no live order AND nothing scheduled — there is
   * literally nothing to tell the client about it. Filtered out below
   * rather than given a state it does not have.
   */
  hasSomethingToShow: boolean
}

/**
 * A standing discount as the client reads it. `percentOff` and `label` are
 * the whole message — "50% off · Production supply orders".
 */
export interface CompanyDiscountLine {
  id: string
  label: string
  percentOff: number
  departmentKey: string | null
  conditions: string | null
  expiryDate: Date | null
}

/** A negotiated per-item price, as the client reads it. */
export interface CompanyNegotiatedRateLine {
  id: string
  /** The catalog item's client-facing name. */
  label: string
  dailyRate: number
  weeklyRate: number | null
  /**
   * Catalog list price at read time — "regularly $400" under the deal.
   * Live, not snapshotted: a list-price change should move this line the
   * same day, or the saving it implies is fiction.
   */
  listDailyRate: number | null
  /**
   * Public page for the thing the deal is on — a vehicle's own page when
   * the item backs a VehicleCategory, else the department's landing.
   * Path only; the renderer prefixes the public origin.
   */
  href: string
  /**
   * Catalog photo for the thing, via the PUBLIC image proxy (which the
   * portal host serves). Only when the vehicle passes the public
   * visibility gate — the proxy 404s otherwise and a broken image is
   * worse than none. Sets have no item-level photo; null.
   */
  photoPath: string | null
}

/**
 * Where a department's public page lives. Wes 2026-09-04: "make sure every
 * tile links the item it references." Paths on sirreel.com — the PORTAL
 * host does not serve these, so callers must prefix PUBLIC_SITE_ORIGIN.
 */
export const DEPARTMENT_PUBLIC_PATH: Record<string, string> = {
  VEHICLES: '/vehicles',
  STAGES: '/stages',
  PRO_SUPPLIES: '/order/supplies',
  EXPENDABLES: '/order/supplies',
  COMMUNICATIONS: '/order/supplies',
  GE: '/order/supplies',
  ART: '/order/supplies',
  WARDROBE_MAKEUP: '/order/supplies',
}

export interface CompanyTermsSummary {
  /**
   * Negotiated prices (CompanyRate) — "$125 on cubes". These REPLACE the
   * list rate on the line; they are not discounts and never render as one.
   * Only rows with a positive daily figure: a weekly-only deal has no
   * headline number to put on a tile.
   */
  negotiatedRates: CompanyNegotiatedRateLine[]
  /**
   * Standing discounts, the first thing on the page (Wes 2026-09-04).
   * Only ACTIVE, in-window rows — a lapsed deal is history for the desk,
   * not a promise to re-make to the client.
   */
  discounts: CompanyDiscountLine[]
  /** The client's own mark, or null. Served through the gated proxy. */
  logoUrl: string | null
  /** Live annual master, or null when the account signs per job. */
  annual: AnnualCoverage | null
  annualCurrent: boolean
  /** An annual master OFFERED for signature in the portal, not yet signed. */
  pendingAnnual: PendingAnnual | null
  /** Every filed master, current or not — the record, not the coverage. */
  filedAgreements: {
    id: string
    title: string
    isAnnual: boolean
    effectiveDate: Date | null
    expiryDate: Date | null
    signerName: string | null
    signedAt: Date | null
    current: boolean
  }[]
  /** Standing LCDW election carried on the annual master. */
  standingLcdw: 'ACCEPTED' | 'DECLINED' | null
  /** Plain-English negotiated terms, if any were recorded. */
  negotiatedSummary: string | null
  negotiatedActiveAsOf: Date | null
  billingEmail: string | null
  coiOnFile: boolean
  coiExpiry: Date | null
  /** The SirReel rep who owns the account. */
  accountRep: { name: string; email: string } | null
}

export interface CompanyOverview {
  companyId: string
  companyName: string
  terms: CompanyTermsSummary
  active: CompanyJobTile[]
  past: CompanyJobTile[]
  /** Rolled across every job shown. */
  totals: { openBalance: number; invoicedYtd: number; activeJobs: number }
}

/** Orders that no longer count as live work. */
const DEAD_ORDER_STATUSES: OrderStatus[] = ['CANCELLED']
const CLOSED_ORDER_STATUSES: OrderStatus[] = ['CLOSED', 'INVOICED', 'RETURNED', 'LD_CHECK']
const ON_JOB_STATUSES: OrderStatus[] = ['ON_JOB', 'LOADED_READY']
const BOOKED_STATUSES: OrderStatus[] = ['APPROVED', 'BOOKED']

/** Invoices a client is allowed to see and that count toward money shown. */
const CLIENT_VISIBLE_INVOICE_STATUSES: InvoiceStatus[] = ['SENT', 'PARTIAL', 'PAID']

const SIGNED_AGREEMENT_STATUSES = [
  'SIGNED_BASELINE',
  'SIGNED_NEGOTIATED',
  'SIGNED_OFFLINE',
] as const

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function isoDay(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

/**
 * Coarse state for one job.
 *
 * Order of decision matters: a human off-ramp on Job.status overrides
 * everything (that is the whole point of the off-ramps), then the live
 * orders speak, then the dates, and only then do we fall back to quoted.
 */
function deriveState(
  jobStatus: JobStatus,
  orderStatuses: OrderStatus[],
  range: { start: Date | null; end: Date | null },
  returnedAt: Date | null,
  now: Date,
): CompanyJobState {
  if (jobStatus === 'HOLD') return 'HOLD'
  if (jobStatus === 'WRAPPED' || returnedAt) return 'WRAPPED'

  const live = orderStatuses.filter((s) => !DEAD_ORDER_STATUSES.includes(s))
  if (live.some((s) => ON_JOB_STATUSES.includes(s))) return 'ON_JOB'

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (range.start && range.end) {
    if (range.end.getTime() < today.getTime()) return 'WRAPPED'
    if (range.start.getTime() <= today.getTime()) return 'ON_JOB'
  }

  if (live.some((s) => BOOKED_STATUSES.includes(s))) return 'UPCOMING'
  if (live.length > 0 && live.every((s) => CLOSED_ORDER_STATUSES.includes(s))) return 'WRAPPED'
  if (live.some((s) => s === 'QUOTE_SENT' || s === 'DRAFT')) return 'QUOTED'
  // No orders at all — a Planyo-era job whose only schedule is a booking.
  // Dates already spoke above; anything left is still ahead of us.
  return range.start ? 'UPCOMING' : 'QUOTED'
}

/**
 * Who the client should write to.
 *
 * `Company.defaultAgent` is the right answer when it is set, but most rows
 * do not have one — Radical Media, the first live account portal, had none
 * while both of its jobs were plainly Wes's. Rendering "SirReel team" at
 * someone whose rep has been on every one of their shows is a worse answer
 * than the true one sitting on the jobs.
 *
 * So: the company's declared agent, else whoever actually runs their work.
 *
 * The fallback is gated on an ACTIVE user, because the placeholder agent is
 * a real row: `Unassigned <unassigned@sirreel.com>` (isActive: false) owns
 * every Planyo-era job, and the first regression check rendered "Your rep:
 * Unassigned" with a mailto to a mailbox nobody reads. A generic "SirReel
 * team" is worse than a name and better than a wrong name.
 */
function resolveAccountRep(
  declared: { name: string | null; email: string | null } | null,
  fromJobs: { name: string | null; email: string | null } | null,
): { name: string; email: string } | null {
  for (const c of [declared, fromJobs]) {
    if (c?.email) return { name: c.name || c.email, email: c.email }
  }
  return null
}

/** The account-level terms block that sits above the job tiles. */
export async function buildCompanyTerms(companyId: string): Promise<CompanyTermsSummary> {
  const now = new Date()
  const [company, discounts, agreements, coverage, pendingAnnual, rates, topAgent] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        billingEmail: true,
        coiOnFile: true,
        coiExpiry: true,
        logoUrl: true,
        negotiatedTermsSummary: true,
        negotiatedTermsActiveAsOf: true,
        defaultAgent: { select: { name: true, email: true } },
      },
    }),
    prisma.companyDiscount.findMany({
      where: {
        companyId,
        isActive: true,
        // In-window on both ends. A discount whose term has run out must
        // stop being advertised the day it lapses, not the day someone
        // remembers to untick it.
        AND: [
          { OR: [{ effectiveDate: null }, { effectiveDate: { lte: now } }] },
          { OR: [{ expiryDate: null }, { expiryDate: { gte: now } }] },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { percentOff: 'desc' }],
      select: {
        id: true,
        label: true,
        percentOff: true,
        departmentKey: true,
        conditions: true,
        expiryDate: true,
      },
    }),
    prisma.companyAgreement.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        originalFilename: true,
        isAnnual: true,
        autoCoverJobs: true,
        effectiveDate: true,
        expiryDate: true,
        signerName: true,
        signedAt: true,
        pendingSignature: true,
      },
    }),
    findCompanyAnnualCoverage(companyId),
    findPendingAnnual(companyId),
    prisma.companyRate.findMany({
      where: { companyId, dailyRate: { gt: 0 } },
      select: {
        id: true,
        dailyRate: true,
        weeklyRate: true,
        inventoryItem: {
          select: {
            code: true,
            description: true,
            dailyRate: true,
            department: true,
            imageUrl: true,
            vehicleCategories: {
              where: { published: true, active: true },
              select: { id: true, slug: true, photoUrl: true, photos: { select: { id: true }, take: 1 } },
              take: 1,
            },
          },
        },
      },
    }),
    // The agent on the most of this client's jobs — the fallback rep.
    prisma.job.groupBy({
      by: ['agentId'],
      // Placeholder agents are excluded at the SOURCE rather than filtered
      // after: taking the top agent first and then rejecting it would leave
      // an account whose top agent is Unassigned with no rep at all, even
      // when a real one is second.
      where: { companyId, status: { not: 'LOST' }, agent: { isActive: true } },
      _count: { agentId: true },
      orderBy: { _count: { agentId: 'desc' } },
      take: 1,
    }),
  ])

  const repFromJobs = topAgent[0]?.agentId
    ? await prisma.user.findFirst({
        where: { id: topAgent[0].agentId, isActive: true },
        select: { name: true, email: true },
      })
    : null

  const filed = agreements.filter((a) => !a.pendingSignature).map((a) => {
    const started = !a.effectiveDate || a.effectiveDate.getTime() <= now.getTime()
    let notExpired = true
    if (a.expiryDate) {
      const end = new Date(a.expiryDate)
      end.setUTCHours(23, 59, 59, 999)
      notExpired = end.getTime() >= now.getTime()
    }
    return {
      id: a.id,
      title: a.title || a.originalFilename,
      isAnnual: a.isAnnual,
      effectiveDate: a.effectiveDate,
      expiryDate: a.expiryDate,
      signerName: a.signerName,
      signedAt: a.signedAt,
      current: started && notExpired,
    }
  })

  return {
    negotiatedRates: rates
      .map((r) => ({
        id: r.id,
        label: r.inventoryItem.description || r.inventoryItem.code,
        dailyRate: Number(r.dailyRate),
        weeklyRate: r.weeklyRate != null && Number(r.weeklyRate) > 0 ? Number(r.weeklyRate) : null,
        listDailyRate:
          r.inventoryItem.dailyRate != null && Number(r.inventoryItem.dailyRate) > 0
            ? Number(r.inventoryItem.dailyRate)
            : null,
        photoPath: (() => {
          const vc = r.inventoryItem.vehicleCategories[0]
          if (!vc) return null
          const hasImage = vc.photos.length > 0 || !!vc.photoUrl || !!r.inventoryItem.imageUrl
          return hasImage ? `/api/public/catalog-image/vehicle/${vc.id}` : null
        })(),
        href: r.inventoryItem.vehicleCategories[0]?.slug
          ? `/vehicles/${r.inventoryItem.vehicleCategories[0].slug}`
          : r.inventoryItem.department === 'STAGES' &&
              /set\b/i.test(r.inventoryItem.description || '')
            ? '/standing-sets'
            : DEPARTMENT_PUBLIC_PATH[r.inventoryItem.department] || '/vehicles',
      }))
      .sort((a, b) => b.dailyRate - a.dailyRate || a.label.localeCompare(b.label)),
    discounts: discounts.map((d) => ({
      id: d.id,
      label: d.label,
      percentOff: d.percentOff,
      departmentKey: d.departmentKey,
      conditions: d.conditions,
      expiryDate: d.expiryDate,
    })),
    logoUrl: company?.logoUrl ?? null,
    annual: coverage,
    annualCurrent: coverage != null,
    pendingAnnual: coverage ? null : pendingAnnual,
    filedAgreements: filed,
    standingLcdw: coverage?.standingLcdwDecision ?? null,
    negotiatedSummary: company?.negotiatedTermsSummary ?? null,
    negotiatedActiveAsOf: company?.negotiatedTermsActiveAsOf ?? null,
    billingEmail: company?.billingEmail ?? null,
    coiOnFile: company?.coiOnFile ?? false,
    coiExpiry: company?.coiExpiry ?? null,
    accountRep: resolveAccountRep(company?.defaultAgent ?? null, repFromJobs),
  }
}

/**
 * The whole account view.
 *
 * `pastLimit` caps the wrapped list — an account with 300 finished shows
 * does not want 300 tiles, and the ones that matter are the recent ones.
 * The archive stays reachable through the "show more" fetch on the API.
 */
export async function buildCompanyOverview(
  companyId: string,
  opts: { pastLimit?: number } = {},
): Promise<CompanyOverview> {
  const pastLimit = opts.pastLimit ?? 24
  const now = new Date()

  const [company, terms, jobs] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } }),
    buildCompanyTerms(companyId),
    prisma.job.findMany({
      where: { companyId, status: { not: 'LOST' } },
      orderBy: { updatedAt: 'desc' },
      // Generous cap — trimmed to active + `pastLimit` recent below. A job
      // an executive can't reach is worse than a slightly larger query.
      take: 400,
      select: {
        id: true,
        jobCode: true,
        name: true,
        status: true,
        returnedAt: true,
        updatedAt: true,
        company: { select: { name: true } },
        agent: { select: { name: true } },
        jobContacts: {
          select: {
            role: true,
            isPrimary: true,
            person: { select: { firstName: true, lastName: true, email: true } },
          },
        },
        bookings: { select: { startDate: true, endDate: true, status: true, jobName: true } },
        orders: {
          select: {
            id: true,
            status: true,
            startDate: true,
            endDate: true,
            invoices: {
              select: { status: true, total: true, balanceDue: true, paidAt: true },
            },
            signedAgreements: { select: { status: true, coveredByAgreementId: true } },
          },
        },
      },
    }),
  ])

  if (!company) {
    throw new Error(`buildCompanyOverview: company ${companyId} not found`)
  }

  // An annual master papers every job on the account — a job with no
  // per-order signature is still signed for. Computed once here rather
  // than per tile.
  const annualCovers = terms.annualCurrent

  const tiles: CompanyJobTile[] = jobs.map((job) => {
    const range = deriveJobDateRange(job.orders, job.bookings)
    const orderStatuses = job.orders.map((o) => o.status)
    const state = deriveState(job.status, orderStatuses, range, job.returnedAt, now)

    const lead = pickPrimaryContact(job.jobContacts)

    let invoiced = 0
    let balance = 0
    let anyInvoice = false
    for (const order of job.orders) {
      for (const inv of order.invoices) {
        if (!CLIENT_VISIBLE_INVOICE_STATUSES.includes(inv.status)) continue
        anyInvoice = true
        invoiced += toNum(inv.total)
        balance += toNum(inv.balanceDue)
      }
    }

    const signed =
      annualCovers ||
      job.orders.some((o) =>
        o.signedAgreements.some(
          (a) =>
            (SIGNED_AGREEMENT_STATUSES as readonly string[]).includes(a.status) ||
            a.coveredByAgreementId != null,
        ),
      )

    return {
      id: job.id,
      jobCode: job.jobCode,
      name: resolveDisplayJobName({
        jobName: job.name,
        bookingJobName: job.bookings[0]?.jobName ?? null,
        companyName: job.company?.name ?? company.name,
      }),
      state,
      startDate: isoDay(range.start),
      endDate: isoDay(range.end),
      leadContactName: lead
        ? `${lead.person.firstName} ${lead.person.lastName}`.trim()
        : null,
      leadContactRole: lead?.role ?? null,
      leadContactEmail: lead?.person.email ?? null,
      repName: job.agent?.name ?? null,
      invoicedTotal: anyInvoice ? invoiced : null,
      balanceDue: balance,
      orderCount: job.orders.length,
      agreementSigned: signed,
      hasSomethingToShow:
        job.orders.some((o) => !DEAD_ORDER_STATUSES.includes(o.status)) ||
        range.start != null ||
        range.end != null,
    }
  })

  // A job with NOTHING on it is not a show — it is a row.
  //
  // Found on the first real account (Radical Media, 2026-09-04):
  // SR-JOB-0131 had zero orders and one CANCELLED booking, and rendered to
  // the client as "Quoted — Morango Rebelz" with no dates and no lead. That
  // reads as an open quote awaiting their decision. There is no quote, and
  // there never was one; the hold was cancelled and nothing replaced it.
  //
  // The filter is deliberately narrow — nothing scheduled AND nothing
  // ordered. A job whose only schedule is a live BOOKING must stay (223
  // Planyo-era jobs are exactly that shape and are real work), and so must
  // a job with orders but no dates yet.
  const showable = tiles.filter((t) => t.hasSomethingToShow)
  const active = showable.filter((t) => t.state !== 'WRAPPED')
  const past = showable.filter((t) => t.state === 'WRAPPED').slice(0, pastLimit)

  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
  let invoicedYtd = 0
  for (const job of jobs) {
    for (const order of job.orders) {
      for (const inv of order.invoices) {
        if (!CLIENT_VISIBLE_INVOICE_STATUSES.includes(inv.status)) continue
        if (inv.paidAt && inv.paidAt.getTime() >= yearStart.getTime()) invoicedYtd += toNum(inv.total)
      }
    }
  }

  return {
    companyId: company.id,
    companyName: company.name,
    terms,
    active,
    past,
    totals: {
      openBalance: tiles.reduce((s, t) => s + t.balanceDue, 0),
      invoicedYtd,
      activeJobs: active.length,
    },
  }
}
