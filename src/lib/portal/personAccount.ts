/**
 * The PERSON's portal home — one coordinator, every show they have run
 * with SirReel, across every production company they have worked for.
 *
 * Wes 2026-09-07: "take an individual person that has worked with multiple
 * companies and multiple jobs. They should have the ability to reference
 * elements of those past jobs, if nothing else as a history."
 *
 * A Person is deliberately NOT scoped to one Company (see CLAUDE.md), so
 * the job set is the union of every way they are attached to a show:
 *   - JobContact (the roster on the job, with a role),
 *   - Booking.personId (the Planyo-era holds name a contact directly),
 *   - PortalAccess.contactId (they were sent a show's portal link).
 *
 * State is the same coarse client reading the company portal uses
 * (`deriveState` in companyOverview.ts) so a show never reads "Wrapped" on
 * the person's home and "On the job" on their company's.
 */

import type { JobRole, OrderStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { deriveJobDateRange } from '@/lib/jobs/dateRange'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'
import { loadRwPortalInvoices } from '@/lib/portal/rwPortalInvoices'
import { findCompanyAnnualCoverage } from '@/lib/orders/annualCoverage'
import {
  CLIENT_VISIBLE_INVOICE_STATUSES,
  DEAD_ORDER_STATUSES,
  JOB_STATE_LABEL,
  SIGNED_AGREEMENT_STATUSES,
  deriveState,
  type CompanyJobState,
} from '@/lib/portal/companyOverview'

export interface PersonAccountOrder {
  id: string
  orderNumber: string
  status: OrderStatus
  quoteStatus: string | null
  total: number | null
  startDate: string | null
  endDate: string | null
  /** The person's OWN live magic link into this order's portal, if any. */
  portalHref: string | null
}

export interface PersonJobTile {
  id: string
  jobCode: string
  name: string
  companyId: string | null
  companyName: string
  /** The person's role on the roster; null when attached only via a booking or a link. */
  role: JobRole | null
  state: CompanyJobState
  stateLabel: string
  startDate: string | null
  endDate: string | null
  orders: PersonAccountOrder[]
  /** Client-visible invoices, HQ + RentalWorks. Null when nothing was ever invoiced. */
  invoicedTotal: number | null
  balanceDue: number
  agreementSigned: boolean
  /** Newest live portal link the person holds on this show. */
  portalHref: string | null
  repName: string | null
}

export interface PersonAccountCompany {
  id: string | null
  name: string
  shows: number
  lastDate: string | null
}

export interface PersonSupplyRequest {
  id: string
  reference: string
  title: string
  status: string
  units: number
  estimatedValue: number
  preferredStartDate: string | null
  preferredEndDate: string | null
  createdAt: string
  convertedJobCode: string | null
}

export interface PersonAccount {
  person: { id: string; firstName: string; lastName: string; email: string }
  /** Quoted, upcoming, on the job, on hold. */
  current: PersonJobTile[]
  /** Wrapped — newest first. */
  history: PersonJobTile[]
  companies: PersonAccountCompany[]
  supplyRequests: PersonSupplyRequest[]
  totals: { shows: number; companies: number; invoiced: number; balanceDue: number }
}

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function isoDay(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

/** Newest-ending first; a show with no dates sorts last. */
function byEndDesc(a: PersonJobTile, b: PersonJobTile): number {
  return (b.endDate ?? '').localeCompare(a.endDate ?? '')
}

/** Running work first, then soonest start; undated last. */
function byCurrentOrder(a: PersonJobTile, b: PersonJobTile): number {
  const rank = (s: CompanyJobState) => (s === 'ON_JOB' ? 0 : s === 'UPCOMING' ? 1 : s === 'QUOTED' ? 2 : 3)
  const r = rank(a.state) - rank(b.state)
  if (r !== 0) return r
  const as = a.startDate ?? '9999-99-99'
  const bs = b.startDate ?? '9999-99-99'
  return as.localeCompare(bs)
}

export async function buildPersonAccount(personId: string): Promise<PersonAccount | null> {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, firstName: true, lastName: true, email: true },
  })
  if (!person) return null

  const now = new Date()

  const jobs = await prisma.job.findMany({
    where: {
      status: { not: 'LOST' },
      OR: [
        { jobContacts: { some: { personId } } },
        { bookings: { some: { personId } } },
        { orders: { some: { portalAccesses: { some: { contactId: personId } } } } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: 400,
    select: {
      id: true,
      jobCode: true,
      name: true,
      status: true,
      returnedAt: true,
      companyId: true,
      company: { select: { id: true, name: true } },
      agent: { select: { name: true, isActive: true } },
      jobContacts: { where: { personId }, select: { role: true, isPrimary: true } },
      bookings: { select: { startDate: true, endDate: true, status: true, jobName: true } },
      rwOrders: { select: { rwOrderNumber: true } },
      orders: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          quoteStatus: true,
          total: true,
          subtotal: true,
          startDate: true,
          endDate: true,
          portalSlug: true,
          portalSunsetAt: true,
          invoices: { select: { status: true, total: true, balanceDue: true } },
          signedAgreements: { select: { status: true, coveredByAgreementId: true } },
          portalAccesses: {
            where: { contactId: personId, revokedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { magicLinkToken: true, magicLinkExpiresAt: true },
          },
        },
      },
    },
  })

  // An annual master on the company papers every show on it. One lookup
  // per distinct company, not per job.
  const companyIds = [...new Set(jobs.map((j) => j.companyId).filter((id): id is string => !!id))]
  const annualByCompany = new Map<string, boolean>()
  await Promise.all(
    companyIds.map(async (id) => {
      const cov = await findCompanyAnnualCoverage(id)
      annualByCompany.set(id, cov != null)
    }),
  )

  const rwByOrder = await loadRwPortalInvoices(
    jobs.flatMap((j) => j.rwOrders.map((o) => o.rwOrderNumber)),
  )

  const tiles: PersonJobTile[] = []
  for (const job of jobs) {
    const range = deriveJobDateRange(job.orders, job.bookings)
    const state = deriveState(
      job.status,
      job.orders.map((o) => o.status),
      range,
      job.returnedAt,
      now,
    )

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
    for (const rwo of job.rwOrders) {
      for (const inv of rwByOrder.get(rwo.rwOrderNumber) ?? []) {
        anyInvoice = true
        invoiced += inv.total
        balance += inv.remaining
      }
    }

    const annualCovers = job.companyId ? annualByCompany.get(job.companyId) === true : false
    const signed =
      annualCovers ||
      job.orders.some((o) =>
        o.signedAgreements.some(
          (a) =>
            (SIGNED_AGREEMENT_STATUSES as readonly string[]).includes(a.status) ||
            a.coveredByAgreementId != null,
        ),
      )

    const orders: PersonAccountOrder[] = job.orders
      .filter((o) => !DEAD_ORDER_STATUSES.includes(o.status))
      .map((o) => {
        const access = o.portalAccesses.find((a) => a.magicLinkExpiresAt.getTime() > now.getTime())
        const sunset = o.portalSunsetAt && o.portalSunsetAt.getTime() < now.getTime()
        const portalHref =
          access && o.portalSlug && !sunset
            ? `/portal/job/${o.portalSlug}?token=${encodeURIComponent(access.magicLinkToken)}`
            : null
        const money = toNum(o.total) || toNum(o.subtotal)
        return {
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status,
          quoteStatus: o.quoteStatus ?? null,
          total: money > 0 ? money : null,
          startDate: isoDay(o.startDate),
          endDate: isoDay(o.endDate),
          portalHref,
        }
      })

    const hasSomethingToShow = orders.length > 0 || range.start != null || range.end != null
    // A job with nothing scheduled and nothing ordered is a row, not a show
    // (same rule as the company portal — see buildCompanyOverview).
    if (!hasSomethingToShow) continue

    const roster = job.jobContacts[0] ?? null
    const companyName = job.company?.name ?? 'Independent'

    tiles.push({
      id: job.id,
      jobCode: job.jobCode,
      name: resolveDisplayJobName({
        jobName: job.name,
        bookingJobName: job.bookings[0]?.jobName ?? null,
        companyName,
      }),
      companyId: job.company?.id ?? null,
      companyName,
      role: roster?.role ?? null,
      state,
      stateLabel: JOB_STATE_LABEL[state],
      startDate: isoDay(range.start),
      endDate: isoDay(range.end),
      orders,
      invoicedTotal: anyInvoice ? invoiced : null,
      balanceDue: balance,
      agreementSigned: signed,
      portalHref: orders.find((o) => o.portalHref)?.portalHref ?? null,
      repName: job.agent?.isActive ? job.agent.name : null,
    })
  }

  const current = tiles.filter((t) => t.state !== 'WRAPPED').sort(byCurrentOrder)
  const history = tiles.filter((t) => t.state === 'WRAPPED').sort(byEndDesc)

  const companyMap = new Map<string, PersonAccountCompany>()
  for (const t of tiles) {
    const key = t.companyId ?? `name:${t.companyName}`
    const cur = companyMap.get(key)
    const last = t.endDate ?? t.startDate
    if (cur) {
      cur.shows += 1
      if (last && (!cur.lastDate || last > cur.lastDate)) cur.lastDate = last
    } else {
      companyMap.set(key, { id: t.companyId, name: t.companyName, shows: 1, lastDate: last })
    }
  }
  const companies = [...companyMap.values()].sort(
    (a, b) => b.shows - a.shows || (b.lastDate ?? '').localeCompare(a.lastDate ?? ''),
  )

  // Supply requests submitted from /order/supplies with this email. The
  // public endpoint stores the exact lowercase address, so a JSON-path
  // equality is the right match.
  const supplyRows = await prisma.inquiry.findMany({
    where: {
      source: 'WEB_FORM',
      sourceMetadata: { path: ['contact', 'email'], equals: person.email.toLowerCase() },
    },
    select: {
      id: true,
      title: true,
      status: true,
      estimatedValue: true,
      preferredStartDate: true,
      preferredEndDate: true,
      createdAt: true,
      sourceMetadata: true,
      convertedJob: { select: { jobCode: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })
  const supplyRequests: PersonSupplyRequest[] = supplyRows.map((r) => {
    const meta =
      (r.sourceMetadata as { reference?: string; cart?: unknown[]; totals?: { units?: number } } | null) ?? null
    return {
      id: r.id,
      reference: meta?.reference ?? r.id.slice(0, 8).toUpperCase(),
      title: r.title,
      status: r.status,
      units: meta?.totals?.units ?? meta?.cart?.length ?? 0,
      estimatedValue: toNum(r.estimatedValue),
      preferredStartDate: isoDay(r.preferredStartDate),
      preferredEndDate: isoDay(r.preferredEndDate),
      createdAt: r.createdAt.toISOString(),
      convertedJobCode: r.convertedJob?.jobCode ?? null,
    }
  })

  return {
    person,
    current,
    history,
    companies,
    supplyRequests,
    totals: {
      shows: tiles.length,
      companies: companies.length,
      invoiced: tiles.reduce((s, t) => s + (t.invoicedTotal ?? 0), 0),
      balanceDue: tiles.reduce((s, t) => s + t.balanceDue, 0),
    },
  }
}
