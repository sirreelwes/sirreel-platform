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
 * What it does NOT copy is the RW list's click-to-charge. Payment against an
 * HQ invoice is recorded on the invoice itself, and a second path into
 * charging — from a search result, where it is easy to have the wrong row
 * selected — is how a client gets billed against someone else's invoice. So
 * a row here opens the document or the job, and that is all.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

interface HqInvoice {
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
  jobId: string | null
  jobName: string | null
  jobCode: string | null
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

export function HqInvoiceSearch() {
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<Scope>('owed')
  const [rows, setRows] = useState<HqInvoice[]>([])
  const [total, setTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
  }, [q, scope, load])

  // A search ignores scope server-side; say so rather than leaving a pill
  // lit over a list it did not filter.
  const searching = q.trim().length > 0

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

      <div className="mt-3 max-h-[320px] overflow-y-auto divide-y divide-zinc-200">
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
            return (
              <div key={i.id} className="py-2.5 px-2">
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
                  <div className="text-xs text-zinc-600 mt-0.5">
                    {money(i.amountPaid)} of {money(i.total)} received
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

                <div className="flex items-center gap-3 text-[11px] text-zinc-600 mt-1">
                  {i.sentAt ? (
                    <span>Sent {shortDate(i.sentAt)}</span>
                  ) : i.preSentAt ? (
                    <span>Pre-invoice sent {shortDate(i.preSentAt)} — not billed</span>
                  ) : (
                    <span>Never sent</span>
                  )}
                  {i.dueDate && <span>Due {ymdShort(i.dueDate)}</span>}
                  {i.paidAt && <span className="text-emerald-700">Paid {shortDate(i.paidAt)}</span>}
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
                </div>
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
