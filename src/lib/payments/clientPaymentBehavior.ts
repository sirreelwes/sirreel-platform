/**
 * Per-client payment behavior — the days-to-pay flywheel (Wes, 2026-08-18).
 *
 * Two signal sources, honestly separated:
 *
 *   OBSERVED  RwInvoicePaidObservation rows with preTracking=false — real
 *             payment events at sync granularity. Started 2026-08-18; ramps
 *             from zero. preTracking rows count toward "payments on record"
 *             but never toward latency math (their dates are unknown).
 *   CURRENT   Open exposure from the mirror right now — balance, count,
 *             oldest days past due. Computable on day one, and for a terms
 *             decision ("require a deposit?") it is most of the signal.
 *
 * HQ-native collections (JobFinalInvoice COLLECTED, uploadedAt→collectedAt)
 * fold into the observed lane when the client's Company links by exact
 * case-insensitive name to the RW customer — imperfect, but RW customerName
 * is the only join key that exists until RW retires.
 *
 * Matching is by exact trimmed lowercase name. No fuzzy matching: a wrong
 * client's history under someone's name is worse than "no data".
 */

import { prisma } from '@/lib/prisma'

export interface ClientPaymentBehavior {
  /** The name the stats were computed under (RW customerName). */
  name: string
  openCount: number
  openTotal: number
  /** Days past due (falling back to invoice date) of the oldest open invoice. */
  oldestOpenDays: number | null
  /** Payments with a REAL observed date — the latency sample size. */
  observedPayments: number
  avgDaysToPay: number | null
  medianDaysToPay: number | null
  lastPaidAt: Date | null
  /** Paid before tracking began — proof of history, dates unknown. */
  preTrackingPayments: number
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/**
 * Batch compute for a set of RW customer names (case-insensitive). Returns a
 * map keyed by the LOWERCASED trimmed name.
 */
export async function clientPaymentBehavior(
  names: string[],
): Promise<Map<string, ClientPaymentBehavior>> {
  const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (wanted.length === 0) return new Map()

  const [open, observations, hqCollected] = await Promise.all([
    prisma.rwInvoice.findMany({
      where: {
        customerName: { in: wanted, mode: 'insensitive' },
        remainingTotal: { gt: 0 },
        NOT: { status: 'VOID' },
      },
      select: { customerName: true, remainingTotal: true, dueDate: true, invoiceDate: true },
    }),
    prisma.rwInvoicePaidObservation.findMany({
      where: { customerName: { in: wanted, mode: 'insensitive' } },
      select: {
        customerName: true,
        invoiceDate: true,
        observedPaidAt: true,
        preTracking: true,
      },
    }),
    prisma.jobFinalInvoice.findMany({
      where: {
        status: 'COLLECTED',
        collectedAt: { not: null },
        job: { company: { name: { in: wanted, mode: 'insensitive' } } },
      },
      select: {
        uploadedAt: true,
        collectedAt: true,
        job: { select: { company: { select: { name: true } } } },
      },
    }),
  ])

  const out = new Map<string, ClientPaymentBehavior>()
  const key = (n: string) => n.trim().toLowerCase()
  const ensure = (name: string): ClientPaymentBehavior => {
    const k = key(name)
    let b = out.get(k)
    if (!b) {
      b = {
        name,
        openCount: 0,
        openTotal: 0,
        oldestOpenDays: null,
        observedPayments: 0,
        avgDaysToPay: null,
        medianDaysToPay: null,
        lastPaidAt: null,
        preTrackingPayments: 0,
      }
      out.set(k, b)
    }
    return b
  }
  for (const n of wanted) ensure(n)

  const now = new Date()
  for (const r of open) {
    if (!r.customerName) continue
    const b = ensure(r.customerName)
    b.openCount++
    b.openTotal += Number(r.remainingTotal)
    const basis = r.dueDate ?? r.invoiceDate
    if (basis) {
      const age = daysBetween(basis, now)
      if (b.oldestOpenDays === null || age > b.oldestOpenDays) b.oldestOpenDays = age
    }
  }

  // Latency samples per client: observed RW payments + HQ-native collections.
  const samples = new Map<string, number[]>()
  const push = (name: string, days: number, paidAt: Date) => {
    const b = ensure(name)
    const k = key(name)
    if (!samples.has(k)) samples.set(k, [])
    // Negative would mean paid before invoiced (deposits) — clamp to 0 rather
    // than letting prepayments drag the average into fiction.
    samples.get(k)!.push(Math.max(0, days))
    if (!b.lastPaidAt || paidAt > b.lastPaidAt) b.lastPaidAt = paidAt
  }
  for (const o of observations) {
    if (!o.customerName) continue
    if (o.preTracking) {
      ensure(o.customerName).preTrackingPayments++
      continue
    }
    if (o.invoiceDate) push(o.customerName, daysBetween(o.invoiceDate, o.observedPaidAt), o.observedPaidAt)
  }
  for (const c of hqCollected) {
    const name = c.job.company?.name
    if (name && c.collectedAt) push(name, daysBetween(c.uploadedAt, c.collectedAt), c.collectedAt)
  }

  for (const [k, arr] of samples) {
    const b = out.get(k)
    if (!b || arr.length === 0) continue
    b.observedPayments = arr.length
    b.avgDaysToPay = Math.round((arr.reduce((s, d) => s + d, 0) / arr.length) * 10) / 10
    const sorted = [...arr].sort((a, z) => a - z)
    const mid = Math.floor(sorted.length / 2)
    b.medianDaysToPay = sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10
  }

  return out
}
