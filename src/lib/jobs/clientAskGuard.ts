/**
 * Is this job still open to CLIENT ASKS? One definition, in one place.
 *
 * Wes 2026-09-18: a rep pressed "Ask the client to name the driver" on
 * SR-JOB-0294 (RB SG Concealer Campaign) and Grace Gallagher was emailed
 * about a shoot that had ended on September 9th — nine days earlier.
 *
 * ── Why nothing stopped it ─────────────────────────────────────────
 *
 * Nothing about that job SAID it was over. Job.status was still NEW,
 * archivedAt was null, returnedAt was null, and its one live order was
 * still BOOKED — because staff don't walk orders through their statuses
 * after the gear is back, and never have (that is the whole premise of
 * src/lib/jobs/cadence.ts). The only fact that knew the job was finished
 * was its DATES: Sep 4 – Sep 9, both in the past.
 *
 * So the guard cannot key on status alone. It reads, in order: the
 * explicit human markers (archived / the three off-ramps / marked
 * returned), then whether anything is left alive at all, then the dates.
 * The date rule is what catches the Grace case and every job like it.
 *
 * ── What this does NOT gate ────────────────────────────────────────
 *
 * Only the RENTAL-TIME asks — mail that is meaningless or alarming once
 * the trucks are back: "who's driving?", after-hours gate codes, a
 * driver's own invite. Money and paperwork deliberately stay open,
 * because chasing an invoice, a COI or a signature AFTER a job wraps is
 * normal collections work, not an accident. Do not widen this to
 * invoices, thank-yous or payment details without Wes saying so.
 *
 * ── Relationship to the 48-hour sweep ──────────────────────────────
 *
 * src/lib/drivers/driverRequestSweep.ts already had these gates in its
 * candidate query, because an unattended cron mailing a closed job was
 * obviously unacceptable. The rep's BUTTON went through the same send
 * function with none of them. This module is those gates, lifted out and
 * pointed at both — so the automated path and the human path can no
 * longer disagree about what "live" means.
 */

import { prisma } from '@/lib/prisma'

export type ClientAskBlockCode =
  | 'archived'
  | 'lost'
  | 'wrapped'
  | 'hold'
  | 'returned'
  | 'cancelled'
  | 'past'

export interface ClientAskBlock {
  code: ClientAskBlockCode
  /** Sentence to put in front of a human, naming the job and the fact. */
  reason: string
  /** Pacific day the work ended, when the dates are what closed it. */
  endedOn: string | null
}

/** Everything the predicate reads. Kept narrow so callers select little. */
export const CLIENT_ASK_SELECT = {
  id: true,
  jobCode: true,
  name: true,
  status: true,
  archivedAt: true,
  returnedAt: true,
  orders: { select: { status: true, startDate: true, endDate: true } },
  bookings: {
    select: {
      status: true,
      startDate: true,
      endDate: true,
      items: { select: { assignments: { select: { status: true, startDate: true, endDate: true } } } },
    },
  },
} as const

export interface ClientAskCandidate {
  id: string
  jobCode: string | null
  name: string
  status: string
  archivedAt: Date | null
  returnedAt: Date | null
  orders: { status: string; startDate: Date | null; endDate: Date | null }[]
  bookings: {
    status: string
    startDate: Date | null
    endDate: Date | null
    items: { assignments: { status: string; startDate: Date | null; endDate: Date | null }[] }[]
  }[]
}

/** Today in Pacific as YYYY-MM-DD — the calendar the yard works to. */
export function pacificToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** @db.Date columns are UTC midnight, so compare day strings, never instants. */
const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null)

const prettyDay = (ymdStr: string): string =>
  new Date(`${ymdStr}T12:00:00.000Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })

/**
 * Every end date still in play. A CANCELLED order, a cancelled or
 * archived booking, and a SWAPPED assignment are all dead weight — a job
 * whose only late date sits on a cancelled order has NOT been extended.
 */
function liveEndDays(job: ClientAskCandidate): string[] {
  const days: (string | null)[] = []
  for (const o of job.orders) {
    if (o.status === 'CANCELLED') continue
    days.push(ymd(o.endDate) ?? ymd(o.startDate))
  }
  for (const b of job.bookings) {
    if (b.status === 'CANCELLED' || b.status === 'ARCHIVED') continue
    days.push(ymd(b.endDate) ?? ymd(b.startDate))
    for (const it of b.items) {
      for (const a of it.assignments) {
        if (a.status === 'SWAPPED') continue
        days.push(ymd(a.endDate) ?? ymd(a.startDate))
      }
    }
  }
  return days.filter((d): d is string => !!d)
}

function hasLiveWork(job: ClientAskCandidate): boolean {
  if (job.orders.some((o) => o.status !== 'CANCELLED')) return true
  return job.bookings.some((b) => b.status !== 'CANCELLED' && b.status !== 'ARCHIVED')
}

/**
 * Why this job is closed to client asks, or null while it is open.
 *
 * A job with NOTHING on it — no orders, no bookings, no dates — is open.
 * That is a job somebody is still building, not a job that finished, and
 * refusing to mail it would break the ordinary new-job flow.
 */
export function clientAskBlock(job: ClientAskCandidate, now: Date = new Date()): ClientAskBlock | null {
  const who = job.jobCode ? `${job.jobCode} (${job.name})` : job.name

  if (job.archivedAt) {
    return { code: 'archived', reason: `${who} is archived.`, endedOn: null }
  }
  if (job.status === 'LOST') {
    return { code: 'lost', reason: `${who} is marked Lost.`, endedOn: null }
  }
  if (job.status === 'WRAPPED') {
    return { code: 'wrapped', reason: `${who} is marked Wrapped.`, endedOn: null }
  }
  if (job.status === 'HOLD') {
    return { code: 'hold', reason: `${who} is on Hold.`, endedOn: null }
  }
  if (job.returnedAt) {
    return {
      code: 'returned',
      reason: `${who} is marked returned — the gear is back.`,
      endedOn: ymd(job.returnedAt),
    }
  }
  if (!hasLiveWork(job) && (job.orders.length > 0 || job.bookings.length > 0)) {
    return { code: 'cancelled', reason: `Everything on ${who} is cancelled.`, endedOn: null }
  }

  const ends = liveEndDays(job)
  if (ends.length === 0) return null
  const last = ends.sort().at(-1)!
  if (last < pacificToday(now)) {
    return {
      code: 'past',
      reason: `${who} ended on ${prettyDay(last)} — its dates are in the past.`,
      endedOn: last,
    }
  }
  return null
}

/** Thrown by assertJobOpenForClientAsk. 409: the job's state refuses it. */
export class JobClosedError extends Error {
  constructor(public block: ClientAskBlock, message: string, public status = 409) {
    super(message)
  }
}

/**
 * The same answer, fetched. Used by the job page so the BUTTON can carry
 * the reason — a rep should be told before the click, not after it; the
 * route-level refusal below is the backstop, not the guardrail.
 */
export async function loadClientAskBlock(jobId: string, now: Date = new Date()): Promise<ClientAskBlock | null> {
  const job = (await prisma.job.findUnique({
    where: { id: jobId },
    select: CLIENT_ASK_SELECT,
  })) as ClientAskCandidate | null
  return job ? clientAskBlock(job, now) : null
}

/**
 * Refuse a client-facing rental-time ask on a finished job.
 *
 * `ask` completes the sentence "…so we're not <ask>" — e.g. 'emailing
 * them about a driver'. The message is read by a rep who just pressed a
 * button and needs to know what to do instead, so it names the job, the
 * fact that closed it, and the two ways out (right job, or reopen it).
 */
export async function assertJobOpenForClientAsk(jobId: string, ask: string, now: Date = new Date()): Promise<void> {
  const block = await loadClientAskBlock(jobId, now)
  if (!block) return // Open, or no such job — callers own "job not found".
  throw new JobClosedError(
    block,
    `${block.reason} Nothing goes out to the client on a finished job, so we're not ${ask}. ` +
      `If this is the wrong job, open the live one; if the job really is still running, ` +
      `put its dates back or clear the status first.`,
  )
}
