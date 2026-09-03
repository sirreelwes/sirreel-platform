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
 * A resumable pull deliberately spans runs, so the age measured is the
 * newest row in the mirror, not the last completed cycle: rows are being
 * refreshed the whole time, and that is what a reader depends on.
 */

import { prisma } from '@/lib/prisma'
import type { RwMirror } from '@/lib/rentalworks/syncAlert'

export interface MirrorHealth {
  mirror: RwMirror
  label: string
  syncedAt: Date | null
  ageHours: number | null
  thresholdHours: number
  stale: boolean
  rows: number
  /** Cursor note from the paged syncs — why the last run stopped. */
  cursor: {
    nextPage: number
    rowsThisCycle: number
    completedAt: Date | null
    lastError: string | null
  } | null
}

const THRESHOLDS: Record<RwMirror, { label: string; hours: number }> = {
  // Daily at 11:00 UTC → two missed runs plus slack.
  invoice: { label: 'Invoices', hours: 36 },
  // Every 6h, and a cycle may legitimately span two or three runs.
  quote: { label: 'Quotes', hours: 36 },
  // Daily, resumable, and the least time-critical of the three.
  orderRef: { label: 'Order index', hours: 48 },
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
    const { label, hours } = THRESHOLDS[mirror]
    return {
      mirror,
      label,
      syncedAt,
      ageHours: ageHours == null ? null : Math.round(ageHours * 10) / 10,
      thresholdHours: hours,
      // A mirror that has NEVER populated is stale by definition — an
      // empty table is the most misleading state of all, because every
      // reader treats "no rows" as "nothing to show".
      stale: ageHours == null || ageHours > hours,
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
    ? `cycle completed ${h.cursor.completedAt.toISOString().slice(0, 16).replace('T', ' ')}`
    : `cycle in progress, next page ${h.cursor.nextPage}, ${h.cursor.rowsThisCycle} rows so far`
  return `${head}\n    ${cyc}${h.cursor.lastError ? `\n    last run: ${h.cursor.lastError}` : ''}`
}
