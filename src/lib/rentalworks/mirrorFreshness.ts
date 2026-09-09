/**
 * Is each RentalWorks mirror actually being refreshed?
 *
 * ── Why ────────────────────────────────────────────────────────────
 *
 * Every RW failure so far has been silent, and each was found only when
 * somebody happened to look:
 *
 *   · the invoice mirror froze on 2026-07-27 and served stale balances
 *     into Collections for three weeks
 *   · the quote and order mirrors froze on 2026-08-22 — the token had
 *     expired — and stayed frozen for eleven days after it was rotated,
 *     because the quote pull could not fit its cron and the order pull
 *     had no cron at all
 *
 * The alerting added after the first one fires on a sync that RETURNS an
 * error. None of these did. The quote run was killed mid-await, so its
 * own catch never executed; the order scan was never scheduled, so
 * nothing could report on it. A sync that dies has nothing to say.
 *
 * The one signal that survives every one of those failure modes is the
 * mirror's own age. Nobody has to be alive to report it, and it is true
 * regardless of WHY the data stopped moving.
 *
 * ── What counts as stale ───────────────────────────────────────────
 *
 * Threshold per mirror is roughly two scheduled runs plus slack, so a
 * single missed or still-resuming run is not an alarm — two in a row is.
 *
 * TWO ages, not one. The newest row is the obvious signal but on its own
 * it lies about a resumable pull: a cycle that keeps restarting, or that
 * only ever gets through its first pages before running out of budget,
 * refreshes page 1 every single run and therefore always looks current —
 * while the rows on the last pages quietly rot. So a mirror with a cursor
 * is ALSO judged on when a cycle last CLOSED, which is the only moment
 * every row in it has been seen. Either age over its limit is stale.
 */

import { prisma } from '@/lib/prisma'
import type { RwMirror } from '@/lib/rentalworks/syncAlert'

export interface MirrorHealth {
  mirror: RwMirror
  label: string
  syncedAt: Date | null
  ageHours: number | null
  thresholdHours: number
  /** Hours since a cycle last closed. Null for mirrors without a cursor. */
  cycleAgeHours: number | null
  /** Limit on cycleAgeHours — a cycle may legitimately span several runs. */
  cycleThresholdHours: number | null
  stale: boolean
  /** Which of the two ages tripped, for the message. */
  staleReason: 'rows' | 'cycle' | null
  rows: number
  /** Cursor note from the paged syncs — why the last run stopped. */
  cursor: {
    nextPage: number
    rowsThisCycle: number
    completedAt: Date | null
    lastError: string | null
  } | null
}

/**
 * ── Lowered 2026-09-09 (Wes) ───────────────────────────────────────
 *
 * These only ever meant anything together with how often the freshness
 * cron RUNS. It ran 4x a day, so the check gap — not the threshold —
 * set how long a dead mirror stayed quiet: the invoice limit was 90
 * minutes but nobody heard for up to 7.5 hours. The cron is hourly now,
 * and these came down with it.
 *
 * ── The floor on a cursor mirror, and why it is not lower ───────────
 *
 * Every row in a paged cycle carries that cycle's START stamp, so
 * `max(syncedAt)` on a HEALTHY quote/order mirror climbs to a full cycle
 * period before it resets. Derived from the crons and the measured fetch
 * times (quote 331.9s, order ~350s, budget 210s a run → 2 runs a cycle,
 * cycles every 4h):
 *
 *   healthy peak today ............ 4h
 *   if RW decays to 3 runs/cycle .. 6h
 *
 * 8h is therefore the floor, not a preference. RW's list endpoints get
 * slower as rows grow — that decay is documented and ongoing — so a
 * threshold under 8h would start firing on a mirror doing exactly what
 * it is supposed to, and an alarm that cries wolf is worse than none.
 * Do not "tighten" these without re-deriving the peak above.
 */
const THRESHOLDS: Record<RwMirror, { label: string; hours: number; cycleHours: number | null }> = {
  // Every 15 minutes (since 2026-09-05 — Ana asked for the balances to
  // keep up with her as she works), all-or-nothing, ~110s a run. Healthy
  // peak row age is ~0.3h, so 1h is about four missed runs. Not tighter:
  // RW answers a bare 503 often enough (three in the week to 09-09) that
  // two consecutive misses are jitter, not an outage.
  invoice: { label: 'Invoices', hours: 1, cycleHours: null },
  // Every 2h since 2026-09-05 (was 6h). Two runs a cycle, cycles every
  // 4h — see the floor note above before changing this.
  quote: { label: 'Quotes', hours: 8, cycleHours: 8 },
  // Every 2h since 2026-09-05 (was three times daily). ~350s of fetch,
  // two runs, same 4h cycle and the same floor.
  orderRef: { label: 'Order index', hours: 8, cycleHours: 8 },
}

export async function checkRwMirrorFreshness(now = new Date()): Promise<MirrorHealth[]> {
  const [inv, quote, order, quoteCursor, orderCursor] = await Promise.all([
    prisma.rwInvoice.aggregate({ _max: { syncedAt: true }, _count: true }),
    prisma.rwQuote.aggregate({ _max: { syncedAt: true }, _count: true }),
    prisma.rwOrderRef.aggregate({ _max: { syncedAt: true }, _count: true }),
    prisma.rwSyncCursor.findUnique({ where: { mirror: 'quote' } }),
    prisma.rwSyncCursor.findUnique({ where: { mirror: 'orderRef' } }),
  ])

  const rows: Array<[RwMirror, { _max: { syncedAt: Date | null }; _count: number }, typeof quoteCursor]> = [
    ['invoice', inv, null],
    ['quote', quote, quoteCursor],
    ['orderRef', order, orderCursor],
  ]

  return rows.map(([mirror, agg, cursor]) => {
    const syncedAt = agg._max.syncedAt
    const ageHours = syncedAt ? (now.getTime() - syncedAt.getTime()) / 3_600_000 : null
    const { label, hours, cycleHours } = THRESHOLDS[mirror]

    // Cycle age only applies once a cursor exists — a mirror mid-way
    // through its FIRST ever cycle has never closed one and must not be
    // reported stale for it.
    const cycleAgeHours =
      cycleHours != null && cursor?.completedAt
        ? (now.getTime() - cursor.completedAt.getTime()) / 3_600_000
        : null

    // A mirror that has NEVER populated is stale by definition — an empty
    // table is the most misleading state of all, because every reader
    // treats "no rows" as "nothing to show".
    const rowsStale = ageHours == null || ageHours > hours
    const cycleStale = cycleAgeHours != null && cycleHours != null && cycleAgeHours > cycleHours
    return {
      mirror,
      label,
      syncedAt,
      ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
      thresholdHours: hours,
      cycleAgeHours: cycleAgeHours == null ? null : Math.round(cycleAgeHours * 10) / 10,
      cycleThresholdHours: cycleHours,
      stale: rowsStale || cycleStale,
      staleReason: rowsStale ? 'rows' : cycleStale ? 'cycle' : null,
      rows: agg._count,
      cursor: cursor
        ? {
            nextPage: cursor.nextPage,
            rowsThisCycle: cursor.rowsThisCycle,
            completedAt: cursor.completedAt,
            lastError: cursor.lastError,
          }
        : null,
    }
  })
}

/** One line per mirror for the alert body. */
export function describeMirror(h: MirrorHealth): string {
  const age =
    h.ageHours == null
      ? 'never populated'
      : `${h.ageHours < 48 ? `${h.ageHours}h` : `${Math.floor(h.ageHours / 24)}d`} old`
  const head = `${h.label}: ${age} (${h.rows.toLocaleString()} rows, limit ${h.thresholdHours}h)`
  if (!h.cursor) return head
  const cyc = h.cursor.completedAt
    ? `cycle completed ${h.cursor.completedAt.toISOString().slice(0, 16).replace('T', ' ')}` +
      (h.cycleAgeHours != null ? ` (${h.cycleAgeHours}h ago, limit ${h.cycleThresholdHours}h)` : '')
    : `cycle in progress, next page ${h.cursor.nextPage}, ${h.cursor.rowsThisCycle} rows so far`
  const why =
    h.staleReason === 'cycle'
      ? '\n    STALE because no cycle has closed in time — early pages keep refreshing while the last pages rot'
      : ''
  return `${head}\n    ${cyc}${h.cursor.lastError ? `\n    last run: ${h.cursor.lastError}` : ''}${why}`
}
