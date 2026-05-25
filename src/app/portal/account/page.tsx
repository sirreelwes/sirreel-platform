/**
 * /portal/account — Phase 2: portal home for the signed-in Person.
 *
 * Server component. Auth gate: read sr_person_session cookie →
 * HMAC verify → load PersonSession (re-check revokedAt) → load
 * Person → query their jobs / orders / bookings / supply requests.
 *
 * Surfaces (each capped at a useful recent count; pagination is
 * Phase 3 work if/when there's actual volume):
 *   - Active jobs the Person is on via JobContact, status not
 *     terminal (not WRAPPED, not LOST).
 *   - Recent orders attached to those jobs (any status).
 *   - Open bookings where Person is the primary contact (not
 *     archived).
 *   - Supply requests submitted from /order/supplies with the
 *     Person's email (sourceMetadata.contact.email match).
 *
 * Read-only. Drilldowns into per-row detail (signed agreements,
 * portal slug, etc.) come in a follow-on chunk — for now the page
 * is a digestible summary so a client knows what's in flight.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import type { BookingStatus } from '@prisma/client'
import {
  PERSON_SESSION_COOKIE,
  verifyPersonSessionCookieValue,
} from '@/lib/portal/personSession'

export const dynamic = 'force-dynamic'

const ACTIVE_JOB_STATUSES = ['QUOTED', 'ACTIVE', 'HOLD'] as const
const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  'REQUEST',
  'AI_REVIEW',
  'PENDING_APPROVAL',
  'CONFIRMED',
  'ACTIVE',
]

function fmtMoney(n: number | null): string {
  if (n == null || n === 0) return '—'
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}
function fmtDate(d: Date | null | string | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  })
}

export default async function PortalAccountPage() {
  const cookieValue = cookies().get(PERSON_SESSION_COOKIE)?.value
  const verified = verifyPersonSessionCookieValue(cookieValue)
  if (!verified) redirect('/portal/auth/sign-in')

  const session = await prisma.personSession.findUnique({
    where: { id: verified.personSessionId },
    select: {
      id: true,
      revokedAt: true,
      person: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  })
  if (!session || session.revokedAt) redirect('/portal/auth/sign-in')

  const person = session.person
  const personEmailLc = person.email.toLowerCase()
  const fullName = `${person.firstName} ${person.lastName}`.trim()

  // ── Jobs the Person is on (via JobContact) ──────────────────
  const jobContacts = await prisma.jobContact.findMany({
    where: { personId: person.id },
    select: {
      job: {
        select: {
          id: true,
          jobCode: true,
          name: true,
          status: true,
          startDate: true,
          endDate: true,
          productionType: true,
          company: { select: { name: true } },
          _count: { select: { orders: true } },
          orders: {
            select: { subtotal: true, status: true },
          },
        },
      },
    },
  })
  const activeJobs = jobContacts
    .map((jc) => jc.job)
    .filter((j) => ACTIVE_JOB_STATUSES.includes(j.status as (typeof ACTIVE_JOB_STATUSES)[number]))
    .sort((a, b) => {
      const aT = a.startDate ? new Date(a.startDate).getTime() : 0
      const bT = b.startDate ? new Date(b.startDate).getTime() : 0
      return bT - aT
    })
    .slice(0, 10)
    .map((j) => ({
      ...j,
      orderTotal: j.orders
        .filter((o) => o.status !== 'CANCELLED')
        .reduce((s, o) => s + Number(o.subtotal || 0), 0),
    }))

  // ── Recent orders across the Person's jobs ──────────────────
  const jobIds = jobContacts.map((jc) => jc.job.id)
  const orders = jobIds.length
    ? await prisma.order.findMany({
        where: { jobId: { in: jobIds } },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          quoteStatus: true,
          subtotal: true,
          total: true,
          startDate: true,
          endDate: true,
          createdAt: true,
          portalSlug: true,
          job: { select: { jobCode: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
    : []

  // ── Bookings the Person is the contact on ──────────────────
  const bookings = await prisma.booking.findMany({
    where: {
      personId: person.id,
      archivedAt: null,
      status: { in: ACTIVE_BOOKING_STATUSES },
    },
    select: {
      id: true,
      bookingNumber: true,
      jobName: true,
      productionName: true,
      startDate: true,
      endDate: true,
      status: true,
      company: { select: { name: true } },
    },
    orderBy: { startDate: 'desc' },
    take: 10,
  })

  // ── Supply requests submitted with this email ──────────────
  // Prisma JSON-path equality matches the exact lowercase email the
  // /api/public/supply-request endpoint stores.
  const supplyRequests = await prisma.inquiry.findMany({
    where: {
      source: 'WEB_FORM',
      sourceMetadata: {
        path: ['contact', 'email'],
        equals: personEmailLc,
      },
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

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Header */}
      <header className="bg-zinc-950 text-white">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-amber-400">SirReel Portal</div>
            <h1 className="text-xl font-semibold text-white mt-1 truncate">
              Hi {person.firstName}
            </h1>
            <div className="text-xs text-zinc-400 mt-0.5 truncate">{person.email}</div>
          </div>
          <form action="/api/portal/auth/signout" method="POST">
            <button
              type="submit"
              className="text-xs font-semibold border border-zinc-700 text-zinc-200 hover:border-zinc-500 px-3 py-1.5 rounded-lg"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Active jobs */}
        <Section title="Active jobs" count={activeJobs.length}>
          {activeJobs.length === 0 ? (
            <Empty>No active jobs right now.</Empty>
          ) : (
            <div className="space-y-3">
              {activeJobs.map((j) => (
                <Card key={j.id}>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono">
                        {j.jobCode}
                        <StatusBadge status={j.status} />
                      </div>
                      <div className="text-sm font-semibold text-zinc-900 mt-0.5 truncate">{j.name}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">{j.company.name}</div>
                    </div>
                    <div className="text-right text-xs text-zinc-500 flex-shrink-0">
                      <div>
                        {fmtDate(j.startDate)} → {fmtDate(j.endDate)}
                      </div>
                      <div className="font-mono text-zinc-700 mt-0.5">
                        {j._count.orders} order{j._count.orders === 1 ? '' : 's'} · {fmtMoney(j.orderTotal)}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Section>

        {/* Orders */}
        <Section title="Recent orders" count={orders.length}>
          {orders.length === 0 ? (
            <Empty>No orders yet. Once your agent prepares a quote it&apos;ll appear here.</Empty>
          ) : (
            <div className="space-y-3">
              {orders.map((o) => (
                <Card key={o.id}>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-zinc-500">{o.orderNumber}</span>
                        <StatusBadge status={o.status} />
                        {o.quoteStatus && <QuoteStatusBadge status={o.quoteStatus} />}
                      </div>
                      <div className="text-sm font-semibold text-zinc-900 mt-0.5 truncate">
                        {o.job.name}
                        <span className="ml-2 text-xs text-zinc-500 font-mono">({o.job.jobCode})</span>
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {fmtDate(o.startDate)} → {fmtDate(o.endDate)}
                      </div>
                    </div>
                    <div className="text-right text-xs text-zinc-500 flex-shrink-0">
                      <div className="font-mono text-zinc-900 text-sm">{fmtMoney(Number(o.total) || Number(o.subtotal) || 0)}</div>
                      <div className="mt-0.5">{fmtDate(o.createdAt)}</div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Section>

        {/* Bookings */}
        <Section title="Bookings" count={bookings.length}>
          {bookings.length === 0 ? (
            <Empty>No active bookings.</Empty>
          ) : (
            <div className="space-y-3">
              {bookings.map((b) => (
                <Card key={b.id}>
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-zinc-500">{b.bookingNumber}</span>
                        <StatusBadge status={b.status} />
                      </div>
                      <div className="text-sm font-semibold text-zinc-900 mt-0.5 truncate">{b.jobName}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">{b.company.name}</div>
                    </div>
                    <div className="text-right text-xs text-zinc-500 flex-shrink-0">
                      <div>
                        {fmtDate(b.startDate)} → {fmtDate(b.endDate)}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Section>

        {/* Supply requests */}
        <Section title="Supply requests" count={supplyRequests.length}>
          {supplyRequests.length === 0 ? (
            <Empty>
              No supply requests yet.{' '}
              <a href="/order/supplies" className="text-amber-700 hover:text-amber-600 underline">
                Build an order →
              </a>
            </Empty>
          ) : (
            <div className="space-y-3">
              {supplyRequests.map((r) => {
                const meta = (r.sourceMetadata as { reference?: string; cart?: unknown[]; totals?: { units?: number; amount?: number } } | null) ?? null
                const ref = meta?.reference ?? r.id.slice(0, 8).toUpperCase()
                const units = meta?.totals?.units ?? meta?.cart?.length ?? 0
                return (
                  <Card key={r.id}>
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-zinc-500">{ref}</span>
                          <StatusBadge status={r.status} />
                          {r.convertedJob && (
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                              {r.convertedJob.jobCode}
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-semibold text-zinc-900 mt-0.5 truncate">{r.title}</div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          {units} unit{units === 1 ? '' : 's'} · est. {fmtMoney(Number(r.estimatedValue) || 0)}
                        </div>
                      </div>
                      <div className="text-right text-xs text-zinc-500 flex-shrink-0">
                        <div>
                          {fmtDate(r.preferredStartDate)} → {fmtDate(r.preferredEndDate)}
                        </div>
                        <div className="mt-0.5">{fmtDate(r.createdAt)}</div>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </Section>

        <div className="text-center text-xs text-zinc-400 pt-4 pb-8">
          Signed in as {fullName || person.email}. Anything missing? Ping your SirReel agent.
        </div>
      </main>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 mb-3 flex items-baseline justify-between">
        <span>{title}</span>
        <span className="text-zinc-400 font-mono normal-case">{count}</span>
      </h2>
      {children}
    </section>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm">
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-dashed border-zinc-200 rounded-xl p-6 text-sm text-zinc-500 text-center">
      {children}
    </div>
  )
}

const STATUS_BADGE: Record<string, string> = {
  // Job statuses
  QUOTED: 'bg-purple-50 text-purple-700 border-purple-200',
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  HOLD: 'bg-amber-50 text-amber-800 border-amber-200',
  WRAPPED: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  LOST: 'bg-rose-50 text-rose-700 border-rose-200',
  // Order statuses
  DRAFT: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  QUOTE_SENT: 'bg-sky-50 text-sky-700 border-sky-200',
  CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RETURNED: 'bg-purple-50 text-purple-700 border-purple-200',
  CLOSED: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  CANCELLED: 'bg-rose-50 text-rose-700 border-rose-200',
  // Booking statuses
  REQUEST: 'bg-amber-50 text-amber-800 border-amber-200',
  AI_REVIEW: 'bg-blue-50 text-blue-700 border-blue-200',
  PENDING_APPROVAL: 'bg-blue-50 text-blue-700 border-blue-200',
  // Inquiry statuses
  NEW: 'bg-amber-50 text-amber-800 border-amber-200',
  CONVERTED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DISMISSED: 'bg-zinc-50 text-zinc-500 border-zinc-200',
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? 'bg-zinc-100 text-zinc-700 border-zinc-200'
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${cls}`}>
      {status}
    </span>
  )
}

function QuoteStatusBadge({ status }: { status: string }) {
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-zinc-100 text-zinc-600">
      q: {status}
    </span>
  )
}
