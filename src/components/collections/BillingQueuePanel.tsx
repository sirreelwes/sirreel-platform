'use client'

/**
 * "To bill" — the day's invoicing list.
 *
 * Ana, 2026-09-08: "I'm going to need the collections dashboard to give me a
 * list of orders that are to be billed each day. Regardless of L&D, I always
 * bill out the day after check-in … It will also be easier for me to take
 * sending HQ invoices off of sales' plate."
 *
 * So this panel sits ABOVE "Ready to collect", because it is the earlier
 * step: an order becomes a bill here, and only then becomes money to chase
 * down there. The list is derived from check-in and invoice state (see
 * src/lib/collections/billingQueue.ts) — nobody hands anything over, which
 * is the point.
 *
 * Both actions are on the row on purpose. Generate cuts the document; Send
 * is what actually bills the client, and it is the one the queue waits for —
 * a generated-but-unsent invoice keeps its row, badged, because the client
 * has not been billed. Sales does not have to be involved in either.
 *
 * What the row does NOT do is hold. A short count on the check-in sheet and
 * a partial return both show as notes and change nothing about the due day,
 * because Ana bills the rental and settles L&D separately.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'

export interface BillingQueueRowView {
  orderId: string
  orderNumber: string
  status: string
  jobId: string
  jobName: string
  jobCode: string | null
  companyName: string | null
  agentName: string | null
  startDate: string | null
  endDate: string | null
  returnedYmd: string
  billOnYmd: string
  basis: 'CHECK_IN_REPORT' | 'GEAR_CHECKED_IN' | 'JOB_RETURNED' | 'DUE_BACK'
  overdueDays: number
  amount: number
  bookedTotal: number | null
  blocked: 'NOT_BOOKED' | null
  draftInvoice: {
    id: string
    invoiceNumber: string
    status: string
    total: number
    preSentAt: string | null
    clientApprovedAt: string | null
    clientChangeRequestedAt: string | null
  } | null
  partialCheckIn: boolean
  checkInDifferences: number
  finalInvoiceOnJob: { status: string; uploadedAt: string } | null
  mark: { status: string; snoozedUntil: string | null; reason: string | null } | null
}

interface QueuePayload {
  today: string
  due: BillingQueueRowView[]
  tomorrow: BillingQueueRowView[]
  snoozed: BillingQueueRowView[]
  stats: {
    dueCount: number
    dueTotal: number
    oldestDays: number
    notBookedCount: number
    dueBackOnlyCount: number
    olderSuppressed: number
  }
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/** A YYYY-MM-DD day, printed. Parsed as UTC so it never slips a day. */
const day = (ymd: string) =>
  new Date(`${ymd}T00:00:00.000Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'numeric',
    day: 'numeric',
  })

/**
 * What the queue is going on. A DUE_BACK row has no human confirmation
 * behind it — the words have to say so, or a calendar guess reads exactly
 * like a counted return.
 */
const BASIS_LABEL: Record<BillingQueueRowView['basis'], string> = {
  CHECK_IN_REPORT: 'check-in sheet filed',
  GEAR_CHECKED_IN: 'gear checked in',
  JOB_RETURNED: 'marked returned',
  DUE_BACK: 'due back — nothing filed',
}

const nextDayYmd = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function Chip({
  tone,
  children,
  title,
}: {
  tone: 'neutral' | 'good' | 'warn' | 'bad'
  children: ReactNode
  title?: string
}) {
  const cls = {
    neutral: 'bg-chip-neutral-bg text-chip-neutral-fg',
    good: 'bg-chip-good-bg text-chip-good-fg',
    warn: 'bg-chip-warn-bg text-chip-warn-fg',
    bad: 'bg-chip-bad-bg text-chip-bad-fg',
  }[tone]
  return (
    <span
      title={title}
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${cls}`}
    >
      {children}
    </span>
  )
}

export function BillingQueuePanel() {
  const [data, setData] = useState<QueuePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** Which row has its snooze/dismiss form open, and which one. */
  const [form, setForm] = useState<{ orderId: string; kind: 'snooze' | 'dismiss' } | null>(null)
  const [formReason, setFormReason] = useState('')
  const [formUntil, setFormUntil] = useState('')
  const [showTomorrow, setShowTomorrow] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/collections/billing-queue')
      const json = await res.json()
      if (!res.ok || json.ok === false) {
        setError(json.error || `Could not load the billing queue (HTTP ${res.status})`)
        return
      }
      setError(null)
      setData(json as QueuePayload)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the billing queue')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const post = async (key: string, url: string, body: Record<string, unknown>) => {
    setBusy(key)
    setError(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.ok === false) {
        setError(json.error || json.reason || `Failed (HTTP ${res.status})`)
        return false
      }
      await load()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
      return false
    } finally {
      setBusy(null)
    }
  }

  const openForm = (row: BillingQueueRowView, kind: 'snooze' | 'dismiss') => {
    setForm({ orderId: row.orderId, kind })
    setFormReason(row.mark?.reason ?? '')
    setFormUntil(row.mark?.snoozedUntil ?? nextDayYmd(data?.today ?? row.billOnYmd))
    setError(null)
  }

  const submitForm = async (row: BillingQueueRowView) => {
    if (!form) return
    const ok = await post(row.orderId, `/api/collections/billing-queue/${row.orderId}`, {
      action: form.kind,
      reason: formReason,
      ...(form.kind === 'snooze' ? { until: formUntil } : {}),
    })
    if (ok) setForm(null)
  }

  /**
   * Send is the only outward-facing thing on this panel — one click emails
   * the client their bill, and it cannot be unsent. So it names the invoice,
   * the amount and who is about to get it before it goes.
   */
  const sendInvoice = async (
    r: BillingQueueRowView,
    inv: NonNullable<BillingQueueRowView['draftInvoice']>,
  ) => {
    if (
      !window.confirm(
        `Send ${inv.invoiceNumber} for ${money(inv.total)} to ${r.companyName ?? 'the client'}?\n\n` +
          `${r.jobName} · ${r.orderNumber}\n\n` +
          'This emails the invoice and its PDF to the job contacts.',
      )
    ) {
      return
    }
    await post(r.orderId, `/api/invoices/${inv.id}/send`, {})
  }

  if (loading) return null
  // A queue that cannot load is worse than one that is empty: Ana would read
  // the silence as "nothing to bill today". Say so instead.
  if (!data) {
    return (
      <div className="bg-lt-card border border-chip-bad-fg/30 rounded-2xl p-4 mb-6">
        <h2 className="text-[15px] font-semibold text-lt-fg">To bill</h2>
        <p className="text-xs text-chip-bad-fg mt-1">{error ?? 'Could not load the billing queue.'}</p>
      </div>
    )
  }

  const { due, tomorrow, snoozed, stats } = data
  const nothing = due.length === 0 && tomorrow.length === 0 && snoozed.length === 0

  const row = (r: BillingQueueRowView, lane: 'due' | 'tomorrow' | 'snoozed') => {
    const formOpen = form?.orderId === r.orderId
    const inv = r.draftInvoice
    return (
      <div key={r.orderId} className="py-2.5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <Link
                href={`/orders/${r.orderId}`}
                className="font-mono text-[12px] font-semibold text-lt-fg hover:underline"
              >
                {r.orderNumber}
              </Link>
              <Link
                href={`/jobs/${r.jobId}`}
                className="text-[13px] font-semibold text-lt-fg hover:underline truncate max-w-[22rem]"
              >
                {r.jobName}
              </Link>
              {r.companyName && (
                <span className="text-[12px] text-lt-fg2 truncate max-w-[16rem]">
                  {r.companyName}
                </span>
              )}
            </div>

            <div className="text-[11px] text-lt-fg3 mt-0.5">
              Back {day(r.returnedYmd)} · {BASIS_LABEL[r.basis]}
              {lane === 'due' && ` · bill day ${day(r.billOnYmd)}`}
              {lane === 'tomorrow' && ` · bills ${day(r.billOnYmd)}`}
              {r.agentName && ` · ${r.agentName}`}
            </div>

            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {lane === 'due' && (
                <Chip tone={r.overdueDays >= 3 ? 'bad' : r.overdueDays >= 1 ? 'warn' : 'neutral'}>
                  {r.overdueDays === 0
                    ? 'Due today'
                    : `${r.overdueDays} day${r.overdueDays === 1 ? '' : 's'} late`}
                </Chip>
              )}
              {/* Cannot be invoiced at all until sales books it — the
                  generator needs the booked snapshot. Says whose move it is
                  rather than failing when the button is pressed. */}
              {r.blocked === 'NOT_BOOKED' && (
                <Chip tone="bad" title={`Order is still ${r.status} — no booked total to invoice against`}>
                  Not booked
                </Chip>
              )}
              {r.basis === 'DUE_BACK' && (
                <Chip tone="warn" title="No check-in sheet, no gear check-in, not marked returned — this row is the calendar talking">
                  Unconfirmed return
                </Chip>
              )}
              {r.partialCheckIn && (
                <Chip tone="warn" title="The inbound sheet covered only part of the order — the rest is still out">
                  Partial return
                </Chip>
              )}
              {r.checkInDifferences > 0 && (
                <Chip tone="warn" title="Lines the check-in sheet recorded as differing from what went out — the L&D conversation, not a hold on billing">
                  {r.checkInDifferences} short on the sheet
                </Chip>
              )}
              {inv && (
                <Chip
                  tone="warn"
                  title="The document exists but the client has not been sent it — that is what this queue is waiting for"
                >
                  {inv.invoiceNumber} not sent
                </Chip>
              )}
              {inv?.clientChangeRequestedAt && (
                <Chip tone="bad" title="The client reviewed the pre-invoice and asked for a change">
                  Changes requested
                </Chip>
              )}
              {inv?.clientApprovedAt && (
                <Chip tone="good" title="The client approved the pre-invoice">
                  Client approved
                </Chip>
              )}
              {!inv?.clientApprovedAt && inv?.preSentAt && (
                <Chip tone="neutral" title="Pre-invoice sent for review — not the bill">
                  In review
                </Chip>
              )}
              {r.finalInvoiceOnJob && (
                <Chip
                  tone="neutral"
                  title="An RW-era final invoice exists on this job — it may already have been billed out of RentalWorks"
                >
                  RW final on job
                </Chip>
              )}
              {r.mark?.status === 'SNOOZED' && r.mark.snoozedUntil && (
                <Chip tone="neutral">Back {day(r.mark.snoozedUntil)}</Chip>
              )}
            </div>

            {r.mark?.reason && (
              <div className="text-[11px] text-lt-fg3 mt-1 italic">“{r.mark.reason}”</div>
            )}
          </div>

          <div className="flex-none text-right">
            <div className="text-[15px] font-bold text-lt-fg">{money(r.amount)}</div>
            <div className="text-[10px] text-lt-fg3">
              {r.bookedTotal === null ? 'quote total' : 'booked'}
            </div>
          </div>
        </div>

        {/* Actions. Generate cuts the document; Send is what bills the
            client and is what clears the row. */}
        {lane !== 'snoozed' && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {!inv ? (
              <button
                onClick={() => void post(r.orderId, `/api/orders/${r.orderId}/invoices`, {})}
                disabled={busy === r.orderId || r.blocked === 'NOT_BOOKED'}
                title={
                  r.blocked === 'NOT_BOOKED'
                    ? 'The order has not been booked — it has no booked total to invoice against'
                    : undefined
                }
                className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-[11px] font-bold"
              >
                {busy === r.orderId ? 'Generating…' : 'Generate invoice'}
              </button>
            ) : (
              <button
                onClick={() => void sendInvoice(r, inv)}
                disabled={busy === r.orderId}
                className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-[11px] font-bold"
              >
                {busy === r.orderId ? 'Sending…' : `Send ${inv.invoiceNumber}`}
              </button>
            )}
            <Link
              href={`/jobs/${r.jobId}`}
              className="px-2.5 py-1 rounded-lg border border-lt-hairline bg-lt-card hover:bg-lt-inner text-[11px] font-semibold text-lt-fg2"
            >
              Open job
            </Link>
            <button
              onClick={() => openForm(r, 'snooze')}
              className="text-[11px] font-semibold text-lt-fg3 hover:text-lt-fg"
            >
              Snooze
            </button>
            <button
              onClick={() => openForm(r, 'dismiss')}
              className="text-[11px] font-semibold text-lt-fg3 hover:text-lt-fg"
            >
              Not billing here
            </button>
          </div>
        )}

        {lane === 'snoozed' && (
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() =>
                void post(r.orderId, `/api/collections/billing-queue/${r.orderId}`, {
                  action: 'restore',
                })
              }
              disabled={busy === r.orderId}
              className="px-2.5 py-1 rounded-lg border border-lt-hairline bg-lt-card hover:bg-lt-inner disabled:opacity-40 text-[11px] font-semibold text-lt-fg2"
            >
              Put back now
            </button>
          </div>
        )}

        {formOpen && (
          <div className="mt-2 rounded-lg border border-lt-hairline bg-lt-inner p-2.5">
            <div className="flex items-end gap-2 flex-wrap">
              {form?.kind === 'snooze' && (
                <label className="text-[11px] font-semibold text-lt-fg2">
                  <span className="block mb-1">Come back on</span>
                  <input
                    type="date"
                    value={formUntil}
                    min={nextDayYmd(data.today)}
                    onChange={(e) => setFormUntil(e.target.value)}
                    className="rounded border border-lt-hairline bg-lt-card px-2 py-1 text-[12px] text-lt-fg"
                  />
                </label>
              )}
              <label className="text-[11px] font-semibold text-lt-fg2 flex-1 min-w-[16rem]">
                <span className="block mb-1">
                  {form?.kind === 'snooze' ? 'Why is it waiting?' : 'Why is it not billed here?'}
                </span>
                <input
                  type="text"
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                  placeholder={
                    form?.kind === 'snooze'
                      ? 'Client asked to hold until the PO lands'
                      : 'Billed in RentalWorks'
                  }
                  className="w-full rounded border border-lt-hairline bg-lt-card px-2 py-1 text-[12px] text-lt-fg"
                />
              </label>
              <button
                onClick={() => void submitForm(r)}
                disabled={busy === r.orderId || !formReason.trim()}
                className="px-2.5 py-1 rounded-lg bg-lt-fg hover:opacity-90 disabled:opacity-40 text-white text-[11px] font-bold"
              >
                {busy === r.orderId ? 'Saving…' : form?.kind === 'snooze' ? 'Snooze' : 'Dismiss'}
              </button>
              <button
                onClick={() => setForm(null)}
                className="text-[11px] font-semibold text-lt-fg3 hover:text-lt-fg px-1"
              >
                Cancel
              </button>
            </div>
            <p className="text-[10px] text-lt-fg3 mt-1.5">
              The row leaves this list, so the reason is what answers “where did{' '}
              {r.orderNumber} go?”. Reversible.
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-2xl p-4 mb-6 transition-colors duration-200 hover:border-lt-fg3/40">
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h2 className="text-[15px] font-semibold text-lt-fg flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">
          To bill
        </h2>
        <span className="flex items-center gap-2 text-[11px]">
          {stats.dueCount > 0 && (
            <span className="text-lt-fg2">
              {stats.dueCount} · {money(stats.dueTotal)}
            </span>
          )}
          {stats.oldestDays >= 2 && (
            <Chip tone={stats.oldestDays >= 5 ? 'bad' : 'warn'}>Oldest {stats.oldestDays}d</Chip>
          )}
          {stats.notBookedCount > 0 && (
            <Chip tone="bad" title="Waiting on sales to book the order before it can be invoiced">
              {stats.notBookedCount} not booked
            </Chip>
          )}
          {stats.dueBackOnlyCount > 0 && (
            <Chip
              tone="warn"
              title="Nobody filed a check-in for these — the queue is going on the order's own end date"
            >
              {stats.dueBackOnlyCount} unconfirmed
            </Chip>
          )}
        </span>
      </div>
      <p className="text-xs text-lt-fg3 mb-3">
        Orders that came back and have no invoice with the client yet. An order checks in one day
        and lands here the next — L&amp;D is settled separately and never holds the bill.
      </p>

      {error && (
        <div className="mb-3 rounded border border-chip-bad-fg/30 bg-chip-bad-bg px-3 py-2 text-[12px] text-chip-bad-fg">
          {error}
        </div>
      )}

      {nothing ? (
        <p className="text-sm text-lt-fg2 py-2">
          Nothing to bill. Orders appear the day after they come back.
        </p>
      ) : (
        <>
          {due.length === 0 ? (
            <p className="text-sm text-lt-fg2 py-2">
              Nothing due today — everything that has come back is billed.
            </p>
          ) : (
            <div className="divide-y divide-lt-hairline max-h-[520px] overflow-y-auto">
              {due.map((r) => row(r, 'due'))}
            </div>
          )}

          {/* Came back today: not work yet, but the difference between a
              quiet morning and a surprise. */}
          {tomorrow.length > 0 && (
            <div className="mt-3 border-t border-lt-hairline pt-2">
              <button
                onClick={() => setShowTomorrow((v) => !v)}
                className="text-[11px] font-semibold text-lt-fg2 hover:text-lt-fg"
              >
                {showTomorrow ? '▾' : '▸'} Back today · bills tomorrow ({tomorrow.length})
              </button>
              {showTomorrow && (
                <div className="divide-y divide-lt-hairline mt-1">
                  {tomorrow.map((r) => row(r, 'tomorrow'))}
                </div>
              )}
            </div>
          )}

          {snoozed.length > 0 && (
            <div className="mt-3 border-t border-lt-hairline pt-2">
              <div className="text-[11px] font-semibold text-lt-fg2 mb-1">
                Snoozed ({snoozed.length})
              </div>
              <div className="divide-y divide-lt-hairline">
                {snoozed.map((r) => row(r, 'snoozed'))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Never silent about the cut-off — a list that quietly stops at 120
          days looks identical to a list with nothing older in it. */}
      {stats.olderSuppressed > 0 && (
        <p className="text-[11px] text-lt-fg3 mt-3 border-t border-lt-hairline pt-2">
          {stats.olderSuppressed} unbilled order{stats.olderSuppressed === 1 ? '' : 's'} came back
          more than 120 days ago and {stats.olderSuppressed === 1 ? 'is' : 'are'} not shown here —{' '}
          <a href="/collections/aging-review" className="font-semibold hover:text-lt-fg">
            aging review →
          </a>
        </p>
      )}
    </div>
  )
}
