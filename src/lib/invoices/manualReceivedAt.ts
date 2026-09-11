/**
 * When a hand-recorded payment was received — the instant stored on
 * Payment.receivedAt, from the calendar day the form sends.
 *
 * The payments route used to store that day as UTC midnight. In Los Angeles
 * that is 4 or 5pm the DAY BEFORE, so a Zelle marked this morning landed in
 * yesterday's end-of-day report (which buckets receivedAt by Pacific day) and
 * the order page listed it a day early. And the form's own default, the UTC
 * date, is already tomorrow after 5pm Pacific.
 *
 *   blank / today    → now: the right day, and tonight's EOD counts it
 *   an earlier day   → noon Pacific that day — inside the day even on the
 *                      23- and 25-hour days either side of a clock change
 *   a later day      → refused: money that has not arrived is not received
 */

import { pacificDayRange } from '@/lib/collections/eodReport'
import { pacificTodayYmd } from '@/lib/invoices/paymentMethods'

export type ReceivedAtResult = { ok: true; at: Date } | { ok: false; error: string }

export function manualReceivedAt(ymd: unknown, now: Date = new Date()): ReceivedAtResult {
  if (ymd == null || ymd === '') return { ok: true, at: now }
  if (
    typeof ymd !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(ymd) ||
    // Round-trip, so 2026-02-30 is refused rather than rolled into March.
    new Date(`${ymd}T00:00:00.000Z`).toISOString().slice(0, 10) !== ymd
  ) {
    return { ok: false, error: 'received date must be a real YYYY-MM-DD day' }
  }
  const today = pacificTodayYmd(now)
  if (ymd > today) {
    return { ok: false, error: 'the received date is in the future — record the payment once it has arrived' }
  }
  if (ymd === today) return { ok: true, at: now }
  return { ok: true, at: new Date(pacificDayRange(ymd).start.getTime() + 12 * 3_600_000) }
}
