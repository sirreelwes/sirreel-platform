/**
 * Turn the URLs the browser recorded into the RECORDS they point at.
 *
 * Wes 2026-09-19: "I'd prefer if it took an AI to find the exact issue, or
 * added some context rather than require more from employees since that
 * will decrease their incentive to continue."
 *
 * Exactly right, and it kills the obvious lazy design (ask the reporter
 * "which job?"). Every question put to the person reporting is a tax on
 * the one behaviour worth encouraging, and the warehouse will simply stop.
 *
 * So the work moves to the server. The shell recorder already knows the
 * person was on `/jobs/clx3f…` and that `POST /api/orders/clz9k…/quote/send`
 * came back 500. Both of those carry ids, and ids are lookups. Nobody has
 * to remember that it was the Riverbend job for CMS — this reads it out of
 * the database and hands it to the triage agent already resolved.
 *
 * Never throws and never blocks a report: a lookup failure returns an
 * empty list, and the report triages on the words alone exactly as before.
 */

import { prisma } from '@/lib/prisma'
import type { BugContext } from '@/lib/bugs/clientContext'

export interface ResolvedEntity {
  kind: 'job' | 'order' | 'company' | 'booking'
  id: string
  /** Human line for the prompt and the board. */
  label: string
}

/**
 * Route shapes that carry an id we can resolve. Covers both the page the
 * person was looking at and the API call that failed underneath it —
 * `/api/orders/<id>/quote/send` is often the only place the id appears.
 */
const PATTERNS: { re: RegExp; kind: ResolvedEntity['kind'] }[] = [
  { re: /\/(?:api\/)?jobs\/([A-Za-z0-9_-]{6,40})/g, kind: 'job' },
  { re: /\/(?:api\/)?orders\/([A-Za-z0-9_-]{6,40})/g, kind: 'order' },
  { re: /\/(?:api\/)?(?:crm|companies)\/([A-Za-z0-9_-]{6,40})/g, kind: 'company' },
  { re: /\/(?:api\/)?(?:scheduling\/)?bookings?\/([A-Za-z0-9_-]{6,40})/g, kind: 'booking' },
]

/** Segments that look like ids but are routes. */
const NOT_AN_ID = new Set([
  'new', 'edit', 'search', 'export', 'import', 'duplicates', 'portals',
  'preview', 'history', 'settings', 'review', 'pending', 'archive',
])

function candidates(ctx: BugContext): Map<ResolvedEntity['kind'], Set<string>> {
  const out = new Map<ResolvedEntity['kind'], Set<string>>()
  const haystack = [
    ...(ctx.pages ?? []).map((p) => p.path),
    ...(ctx.failedRequests ?? []).map((r) => r.url),
  ]
  for (const url of haystack) {
    for (const { re, kind } of PATTERNS) {
      // Fresh lastIndex per url — a shared /g regex is stateful.
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(url))) {
        const id = m[1]
        if (NOT_AN_ID.has(id.toLowerCase())) continue
        if (!out.has(kind)) out.set(kind, new Set())
        out.get(kind)!.add(id)
      }
    }
  }
  return out
}

export async function resolveBugContext(ctx: BugContext | null): Promise<ResolvedEntity[]> {
  if (!ctx) return []
  try {
    const found = candidates(ctx)
    // Bounded: a rogue buffer must not turn one bug report into 200 lookups.
    const take = (k: ResolvedEntity['kind']) => [...(found.get(k) ?? [])].slice(0, 5)
    const jobIds = take('job')
    const orderIds = take('order')
    const companyIds = take('company')
    const bookingIds = take('booking')
    if (!jobIds.length && !orderIds.length && !companyIds.length && !bookingIds.length) return []

    const [jobs, orders, companies, bookings] = await Promise.all([
      jobIds.length
        ? prisma.job.findMany({
            where: { id: { in: jobIds } },
            select: { id: true, jobCode: true, name: true, company: { select: { name: true } } },
          })
        : [],
      orderIds.length
        ? prisma.order.findMany({
            where: { id: { in: orderIds } },
            select: {
              id: true, orderNumber: true, status: true,
              job: { select: { jobCode: true, name: true } },
            },
          })
        : [],
      companyIds.length
        ? prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
        : [],
      bookingIds.length
        ? prisma.booking.findMany({
            where: { id: { in: bookingIds } },
            select: { id: true, bookingNumber: true, status: true },
          })
        : [],
    ])

    const out: ResolvedEntity[] = []
    for (const j of jobs) {
      out.push({
        kind: 'job',
        id: j.id,
        label: `Job ${j.jobCode} — "${j.name}"${j.company?.name ? ` for ${j.company.name}` : ''}`,
      })
    }
    for (const o of orders) {
      out.push({
        kind: 'order',
        id: o.id,
        label: `Order ${o.orderNumber} (${o.status})${o.job ? ` on ${o.job.jobCode} "${o.job.name}"` : ''}`,
      })
    }
    for (const c of companies) out.push({ kind: 'company', id: c.id, label: `Company ${c.name}` })
    for (const b of bookings) {
      out.push({ kind: 'booking', id: b.id, label: `Booking ${b.bookingNumber} (${b.status})` })
    }
    return out
  } catch {
    return []
  }
}

/** One block for the triage prompt. Empty string when nothing resolved. */
export function describeResolved(entities: ResolvedEntity[]): string {
  if (!entities.length) return ''
  return `\nRECORDS THOSE URLS POINT AT (looked up for you — the reporter did not type these):\n${entities
    .map((e) => `  - ${e.label}`)
    .join('\n')}`
}
