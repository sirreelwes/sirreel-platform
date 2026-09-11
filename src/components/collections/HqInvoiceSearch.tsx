'use client'

/**
 * "All HQ invoices" — the search box for SirReel's own invoices.
 *
 * Ana, 2026-09-09: "is it possible for me to get a search bar for all
 * invoices? I have a search bar for RentalWorks but will need to be able to
 * access the HQ ones going forward."
 *
 * Sits directly beneath "All RentalWorks invoices" and is built to read like
 * it — same card, same box, same behaviour (blank = what is owed, oldest
 * first; typing searches everything, newest first). Two invoice systems is
 * already one more than anyone wants; two different search boxes on top of
 * that would be gratuitous.
 *
 * Scope pills (Ana, 2026-09-09: "is there a way to access paid invoices?
 * Right now the path is likely roundabout") browse the blank list — owed,
 * paid, or all. They apply to the LIST, not to a search: typing a number
 * searches everything, because a filtered search is how an invoice someone
 * is holding in their hand comes back "not found" for having been paid. The
 * pills dim and say so while the box has text.
 *
 * Charging. This list first shipped read-only — a click-to-charge from a
 * search result, where it is easy to have the wrong row selected, is how a
 * client gets billed against someone else's invoice. Ana, 2026-09-10: "the
 * Collections module lets me charge out RentalWorks invoices but not HQ
 * invoices. I currently have to charge out via CardPointe" — i.e. the
 * gateway's own virtual terminal, which records nothing on the invoice. So
 * the row now carries an explicit CHARGE button (not a row click), only on
 * an invoice that is SENT or PARTIAL with a balance, and the charge panel
 * names the invoice, the client and the balance before anything is keyed.
 * The charge itself records a real Payment on the invoice, which is what
 * flips it PAID and closes the order — see /api/collections/charge.
 *
 * Marking paid. Ana, 2026-09-11: a way to mark HQ invoices paid by hand when
 * the money came by Zelle, wire or ACH — with the option to show HOW it was
 * paid. Same explicit-button rule as Charge, and the form opens UNDER the row
 * it belongs to, naming the invoice, the client and the balance, so there is
 * no armed panel elsewhere on the page to have the wrong row in. There is no
 * default method: a pre-picked "Wire" is how a Zelle gets recorded as a wire.
 * It writes through /api/invoices/[id]/payments → recordPayment, the same
 * Payment the order page records and a charge writes, so PAID, the order
 * close, the EOD figure and the stamped PDF all follow with no second path.
 * Settled and part-paid rows then say how the money came.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import {
  MANUAL_PAYMENT_METHODS,
  REFERENCE_HINT,
  pacificTodayYmd,
  paidViaLabel,
  paymentMethodLabel,
  type ManualPaymentMethod,
} from '@/lib/invoices/paymentMethods'

export interface HqInvoice {
  id: string
  invoiceNumber: string
  type: string
  status: string
  total: number
  amountPaid: number
  balanceDue: number
  dueDate: string | null
  sentAt: string | null
  paidAt: string | null
  createdAt: string
  hasPdf: boolean
  preSentAt: string | null
  clientApprovedAt: string | null
  clientChangeRequestedAt: string | null
  orderId: string
  orderNumber: string
  companyName: string | null
  companyId: string | null
  jobId: string | null
  jobName: string | null
  jobCode: string | null
  /** Cleared, unvoided payments, oldest first — how the money came. */
  payments: { method: string; reference: string | null; receivedAt: string; amount: number }[]
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const shortDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
    : null

/** A YYYY-MM-DD day. Read in UTC — a due date is a day on a calendar, and
 *  formatting it locally prints the day before west of Greenwich. */
const ymdShort = (ymd: string | null) =>
  ymd
    ? new Date(`${ymd}T00:00:00.000Z`).toLocaleDateString('en-US', {
        timeZone: 'UTC',
        month: 'numeric',
        day: 'numeric',
        year: '2-digit',
      })
    : null

/** Days past due, for the aging note on an unpaid row. */
function daysPastDue(dueYmd: string | null): number | null {
  if (!dueYmd) return null
  const due = Date.parse(`${dueYmd}T00:00:00.000Z`)
  const days = Math.floor((Date.now() - due) / 86_400_000)
  return days > 0 ? days : null
}

/** The status word, coloured by what it means for the money. */
function StatusChip({ inv }: { inv: HqInvoice }) {
  const tone =
    inv.status === 'PAID'
      ? 'bg-chip-good-bg text-chip-good-fg'
      : inv.status === 'VOID'
        ? 'bg-chip-neutral-bg text-chip-neutral-fg'
        : inv.status === 'DRAFT'
          ? 'bg-chip-warn-bg text-chip-warn-fg'
          : 'bg-chip-bad-bg text-chip-bad-fg'
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${tone}`}
      title={
        inv.status === 'DRAFT'
          ? 'Generated but never sent — the client does not have this'
          : undefined
      }
    >
      {inv.status}
    </span>
  )
}

type Scope = 'owed' | 'paid' | 'all'

const SCOPES: { key: Scope; label: string; hint: string }[] = [
  { key: 'owed', label: 'Owed', hint: 'Sent and still carrying a balance — the collections worklist' },
  { key: 'paid', label: 'Paid', hint: 'Settled invoices, most recently paid first' },
  { key: 'all', label: 'All', hint: 'Every HQ invoice, newest first — including drafts and voids' },
]

/** Can money be taken against this row? Same rule the charge route
 *  enforces: issued, not settled, not void. */
export function hqInvoiceChargeable(i: HqInvoice): boolean {
  return (i.status === 'SENT' || i.status === 'PARTIAL') && i.balanceDue > 0
}

interface RecordedPayment {
  paymentId: string
  invoiceId: string
  line: string
}

const FIELD_LABEL = 'flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600'
const FIELD_INPUT =
  'bg-white border border-zinc-300 rounded-md px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-zinc-900 placeholder:text-zinc-500 outline-none focus:border-amber-600'

/** Record money that already arrived outside HQ against one invoice. */
function MarkPaidForm({
  inv,
  onRecorded,
  onCancel,
}: {
  inv: HqInvoice
  onRecorded: (r: RecordedPayment) => void
  onCancel: () => void
}) {
  const [method, setMethod] = useState<ManualPaymentMethod | null>(null)
  const [amount, setAmount] = useState(inv.balanceDue.toFixed(2))
  const [receivedOn, setReceivedOn] = useState(() => pacificTodayYmd())
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // The list scrolls inside its own box; a form opened on a low row would
  // otherwise sit below the fold of that box.
  useEffect(() => {
    formRef.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  const amt = Math.round(Number(amount) * 100) / 100
  const validAmount = Number.isFinite(amt) && amt > 0
  const over = validAmount && amt > inv.balanceDue + 0.005
  const partial = validAmount && !over && amt < inv.balanceDue - 0.005
  // Other is the one method that says nothing on its own.
  const unexplained = method === 'OTHER' && !reference.trim() && !note.trim()
  const canSave = !!method && validAmount && !over && !unexplained && !!receivedOn && !saving

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!canSave || !method) return
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/invoices/${inv.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          method,
          receivedAt: receivedOn,
          reference: reference.trim(),
          notes: note.trim(),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setErr(json.error || `Could not record the payment (HTTP ${res.status})`)
        setSaving(false)
        return
      }
      const settled = json.invoice?.status === 'PAID'
      onRecorded({
        paymentId: json.paymentId,
        invoiceId: inv.id,
        line: `${money(amt)} by ${paymentMethodLabel(method)} recorded on ${inv.invoiceNumber} — ${
          settled ? 'paid in full' : `${money(Number(json.invoice?.balanceDue ?? 0))} still due`
        }.`,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not record the payment')
      setSaving(false)
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="mt-2 rounded-lg border border-zinc-300 bg-white p-3 space-y-3">
      <div className="text-xs text-zinc-700">
        <span className="font-semibold text-zinc-900">Mark {inv.invoiceNumber} paid</span>
        {` · ${inv.companyName || '—'} · ${money(inv.balanceDue)} due`}
        <div className="text-[11px] text-zinc-600 mt-0.5">
          For money already in the bank. A card is charged, not marked — use Charge.
        </div>
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 mb-1">
          How was it paid?
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MANUAL_PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              aria-pressed={method === m}
              className={`px-2.5 py-1 rounded-full text-[12px] font-semibold border transition-colors ${
                method === m
                  ? 'border-amber-600 bg-amber-600 text-white'
                  : 'border-zinc-300 text-zinc-700 hover:border-zinc-400'
              }`}
            >
              {paymentMethodLabel(m)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className={FIELD_LABEL}>
          Amount
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={FIELD_INPUT}
          />
          <span className="font-normal normal-case tracking-normal text-[11px] text-zinc-600">
            {over ? (
              <span className="text-red-700">More than the {money(inv.balanceDue)} due</span>
            ) : partial ? (
              `Part-payment — ${money(inv.balanceDue - amt)} stays due`
            ) : validAmount ? (
              'The full balance'
            ) : (
              'Enter the amount received'
            )}
          </span>
        </label>
        <label className={FIELD_LABEL}>
          Received
          <input
            type="date"
            value={receivedOn}
            max={pacificTodayYmd()}
            onChange={(e) => setReceivedOn(e.target.value)}
            className={FIELD_INPUT}
          />
        </label>
        <label className={FIELD_LABEL}>
          {method === 'OTHER' ? 'Reference — or a note' : 'Reference'}
          <input
            type="text"
            value={reference}
            maxLength={200}
            onChange={(e) => setReference(e.target.value)}
            placeholder={method ? REFERENCE_HINT[method] : 'Confirmation, trace or check #'}
            className={FIELD_INPUT}
          />
        </label>
        <label className={FIELD_LABEL}>
          Note (optional)
          <input
            type="text"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            className={FIELD_INPUT}
          />
        </label>
      </div>

      {err && (
        <div className="rounded border border-red-300 bg-red-50 px-2 py-1.5 text-[12px] text-red-700">{err}</div>
      )}

      <div className="flex items-center justify-end gap-2">
        {unexplained && (
          <span className="mr-auto text-[11px] text-zinc-600">Other needs a reference or a note saying how.</span>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold text-zinc-600 hover:text-zinc-900"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSave}
          title={!method ? 'Pick how it was paid first' : undefined}
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-amber-600 hover:bg-amber-500 text-white disabled:bg-zinc-200 disabled:text-zinc-500 disabled:cursor-not-allowed"
        >
          {saving
            ? 'Recording…'
            : method && validAmount
              ? `Record ${money(amt)} by ${paymentMethodLabel(method)}`
              : 'Record payment'}
        </button>
      </div>
    </form>
  )
}

export function HqInvoiceSearch({
  onCharge,
  onRecorded,
  selectedId,
  refreshKey,
}: {
  /** Hands a chargeable row to the charge panel. Absent → no Charge button. */
  onCharge?: (invoice: HqInvoice) => void
  /** Offers Mark paid, and is told which invoice's balance just moved (a
   *  payment recorded, or undone). Absent → no Mark paid button. */
  onRecorded?: (invoiceId: string) => void
  /** The row currently armed in the charge panel, for the highlight. */
  selectedId?: string | null
  /** Bump to re-fetch — after a charge lands, the row's balance changed. */
  refreshKey?: number
} = {}) {
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<Scope>('owed')
  const [rows, setRows] = useState<HqInvoice[]>([])
  const [total, setTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [recorded, setRecorded] = useState<RecordedPayment | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async (query: string, sc: Scope) => {
    // Every keystroke fires a request; without this an earlier, slower
    // response can land last and paint results for a query the box no longer
    // holds.
    const mine = ++seq.current
    try {
      const res = await fetch(
        `/api/collections/invoices?q=${encodeURIComponent(query)}&scope=${sc}`,
      )
      const json = await res.json()
      if (mine !== seq.current) return
      if (!res.ok || json.ok === false) {
        setError(json.error || `Could not search invoices (HTTP ${res.status})`)
        return
      }
      setError(null)
      setRows(json.invoices ?? [])
      setTotal(json.total ?? 0)
      setTruncated(!!json.truncated)
    } catch (e) {
      if (mine !== seq.current) return
      setError(e instanceof Error ? e.message : 'Could not search invoices')
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void load(q, scope), q ? 250 : 0)
    return () => clearTimeout(t)
  }, [q, scope, load, refreshKey])

  // A search ignores scope server-side; say so rather than leaving a pill
  // lit over a list it did not filter.
  const searching = q.trim().length > 0

  const handleRecorded = (r: RecordedPayment) => {
    setMarkingId(null)
    setUndoError(null)
    setRecorded(r)
    void load(q, scope)
    onRecorded?.(r.invoiceId)
  }

  // Undo is for the minute after — the wrong method or amount, noticed at
  // once. It VOIDS the payment it just wrote (the audit trail keeps both), so
  // the invoice goes back to where it was. Later than that, void on the order.
  const undoRecorded = async () => {
    if (!recorded || undoing) return
    setUndoing(true)
    setUndoError(null)
    try {
      const res = await fetch(`/api/payments/${recorded.paymentId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Recorded in error — undone from Collections' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setUndoError(json.error || `Could not undo (HTTP ${res.status})`)
        return
      }
      setRecorded(null)
      void load(q, scope)
      onRecorded?.(recorded.invoiceId)
    } catch (e) {
      setUndoError(e instanceof Error ? e.message : 'Could not undo')
    } finally {
      setUndoing(false)
    }
  }

  return (
    <div className="bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">
          All HQ invoices
        </h2>
        {total > 0 && (
          <span className="text-[11px] text-zinc-600">
            {searching
              ? `${total} ${total === 1 ? 'match' : 'matches'}`
              : scope === 'owed'
                ? `${total} owed`
                : scope === 'paid'
                  ? `${total} paid`
                  : `${total} total`}
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-600 mb-3">
        SirReel&rsquo;s own invoices — the ones generated and sent from HQ, not RentalWorks.
      </p>

      <input
        className="w-full bg-white border border-zinc-300 rounded-lg px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 outline-none focus:border-amber-600"
        placeholder="Search invoice #, order #, client, job… (searches every invoice)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="mt-2 flex items-center gap-1.5">
        {SCOPES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setScope(s.key)}
            title={searching ? 'Clear the search box to browse by status' : s.hint}
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${
              searching
                ? 'border-zinc-200 text-zinc-400'
                : scope === s.key
                  ? 'border-amber-600 bg-amber-50 text-amber-800'
                  : 'border-zinc-300 text-zinc-600 hover:border-zinc-400'
            }`}
          >
            {s.label}
          </button>
        ))}
        {searching && (
          <span className="text-[11px] text-zinc-500">Searching every invoice</span>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
        </div>
      )}

      {recorded && (
        <div className="mt-3 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
          <div className="flex items-center gap-3">
            <span className="flex-1">{recorded.line}</span>
            <button
              type="button"
              onClick={() => void undoRecorded()}
              disabled={undoing}
              className="font-semibold underline underline-offset-2 hover:text-emerald-950 disabled:opacity-60"
              title="Void the payment just recorded — the invoice goes back to what it owed"
            >
              {undoing ? 'Undoing…' : 'Undo'}
            </button>
            <button
              type="button"
              onClick={() => setRecorded(null)}
              className="text-emerald-700 hover:text-emerald-950"
            >
              Dismiss
            </button>
          </div>
          {undoError && <div className="mt-1 text-red-700">{undoError}</div>}
        </div>
      )}

      <div
        className={`mt-3 overflow-y-auto divide-y divide-zinc-200 ${markingId ? 'max-h-[600px]' : 'max-h-[320px]'}`}
      >
        {loading && rows.length === 0 ? (
          <div className="py-6 text-sm text-zinc-600 text-center">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-sm text-zinc-600 text-center">
            {searching
              ? `Nothing matches “${q.trim()}”.`
              : scope === 'paid'
                ? 'No HQ invoices settled yet. Billing that runs through RentalWorks is in the list above.'
                : scope === 'all'
                  ? 'No HQ invoices yet.'
                  : 'No HQ invoices with a balance. Anything owed will appear here once it is sent.'}
          </div>
        ) : (
          rows.map((i) => {
            const late = i.status !== 'PAID' && i.status !== 'VOID' ? daysPastDue(i.dueDate) : null
            const selected = !!selectedId && selectedId === i.id
            const marking = markingId === i.id
            // How the money came — "Zelle", "Wire + Card". The references
            // ride in the tooltip; the row has no room for a trace number.
            const via = paidViaLabel((i.payments ?? []).map((p) => p.method))
            const refs = (i.payments ?? [])
              .filter((p) => p.reference)
              .map((p) => `${paymentMethodLabel(p.method)} ${p.reference}`)
              .join(' · ')
            return (
              <div
                key={i.id}
                className={`py-2.5 px-2 rounded transition-colors ${selected ? 'bg-amber-600/15' : ''}`}
              >
                <div className="flex justify-between gap-3">
                  <span className="text-sm font-semibold text-zinc-900">
                    {i.invoiceNumber}
                    {i.type === 'LD' && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-700">
                        L&amp;D
                      </span>
                    )}
                    {i.hasPdf && (
                      <a
                        href={`/api/invoices/${i.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-xs font-normal text-amber-700 hover:text-amber-800"
                      >
                        PDF
                      </a>
                    )}
                  </span>
                  <span className="text-right shrink-0">
                    {i.balanceDue > 0 ? (
                      <span className="text-sm font-semibold text-amber-700">
                        {money(i.balanceDue)} due
                      </span>
                    ) : (
                      <span className="text-sm font-semibold text-emerald-700">
                        {money(i.total)} paid
                      </span>
                    )}
                  </span>
                </div>

                {/* Part-paid changes the phone call — same phrasing the RW
                    list and the aging review use. */}
                {i.amountPaid > 0 && i.balanceDue > 0 && (
                  <div className="text-xs text-zinc-600 mt-0.5" title={refs || undefined}>
                    {money(i.amountPaid)} of {money(i.total)} received{via ? ` by ${via}` : ''}
                  </div>
                )}

                <div className="flex justify-between gap-3 text-xs mt-0.5">
                  <span className="text-zinc-600 truncate">
                    {i.companyName || '—'}
                    {i.jobName ? ` · ${i.jobName}` : ''}
                    {` · ${i.orderNumber}`}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {late && (
                      <span className={`font-semibold ${late > 30 ? 'text-red-700' : 'text-amber-700'}`}>
                        {late}d late
                      </span>
                    )}
                    <StatusChip inv={i} />
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-600 mt-1">
                  {i.sentAt ? (
                    <span>Sent {shortDate(i.sentAt)}</span>
                  ) : i.preSentAt ? (
                    <span>Pre-invoice sent {shortDate(i.preSentAt)} — not billed</span>
                  ) : (
                    <span>Never sent</span>
                  )}
                  {i.dueDate && <span>Due {ymdShort(i.dueDate)}</span>}
                  {i.paidAt && (
                    <span className="text-emerald-700" title={refs || undefined}>
                      Paid {shortDate(i.paidAt)}
                      {via ? ` by ${via}` : ''}
                    </span>
                  )}
                  {i.clientChangeRequestedAt && (
                    <span className="text-red-700">Client asked for a change</span>
                  )}
                  <span className="flex-1" />
                  {i.jobId && (
                    <Link href={`/jobs/${i.jobId}`} className="font-semibold hover:text-zinc-900">
                      Job →
                    </Link>
                  )}
                  <Link href={`/orders/${i.orderId}`} className="font-semibold hover:text-zinc-900">
                    Order →
                  </Link>
                  {onRecorded && hqInvoiceChargeable(i) && (
                    <button
                      type="button"
                      onClick={() => setMarkingId(marking ? null : i.id)}
                      aria-expanded={marking}
                      title="Zelle, wire, ACH or check that has already arrived — record it on this invoice"
                      className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        marking
                          ? 'border-zinc-500 bg-zinc-100 text-zinc-900'
                          : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100'
                      }`}
                    >
                      Mark paid
                    </button>
                  )}
                  {onCharge && hqInvoiceChargeable(i) && (
                    <button
                      type="button"
                      onClick={() => onCharge(i)}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        selected
                          ? 'bg-amber-600 text-white'
                          : 'border border-amber-600/50 text-amber-700 hover:bg-amber-600 hover:text-white'
                      }`}
                    >
                      {selected ? 'Selected' : 'Charge'}
                    </button>
                  )}
                </div>

                {marking && (
                  <MarkPaidForm
                    key={i.id}
                    inv={i}
                    onRecorded={handleRecorded}
                    onCancel={() => setMarkingId(null)}
                  />
                )}
              </div>
            )
          })
        )}
      </div>

      {truncated && (
        <p className="text-[11px] text-zinc-600 mt-2 border-t border-zinc-200 pt-2">
          Showing the first {rows.length} of {total}. Narrow the search to see the rest.
        </p>
      )}
    </div>
  )
}
