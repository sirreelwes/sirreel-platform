'use client'

/**
 * /collections/aging-review — Ana's triage of the aged receivable.
 *
 * Every open invoice past 60 days, oldest first, with a decision per row:
 * Still owed / Dispute / Write off (+ note). Decisions are DATA — they feed
 * the Outstanding tile (write-offs leave it), the collectible list, and the
 * write-off ledger at the bottom, which is the bad-debt list for taxes with
 * decided dates and amounts.
 *
 * "Mark paid" is inline but goes through the EXISTING mark-paid route
 * (RwInvoicePaidMark) — one mechanism for "paid", surfaced here too.
 * Write off is Wes-only (server-enforced; the button follows).
 */

import { useCallback, useEffect, useState } from 'react'

interface Row {
  rwInvoiceId: string
  invoiceNumber: string | null
  customerName: string | null
  dealName: string | null
  orderNumber: string | null
  agent: string | null
  invoiceDate: string | null
  dueDate: string | null
  invoiceTotal: number
  receivedTotal: number
  remainingTotal: number
  ageDays: number
  triage: { decision: string; note: string | null; decidedAt: string; decidedBy: string | null } | null
  /** Waiting on an insurance carrier rather than the client. */
  insurance: { claimNumber: string | null; note: string | null } | null
}

interface WriteOff {
  rwInvoiceId: string
  invoiceNumber: string | null
  customerName: string | null
  amount: number
  note: string | null
  decidedAt: string
  decidedBy: string | null
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const DECISION_STYLE: Record<string, string> = {
  STILL_OWED: 'bg-sky-900/40 border-sky-700/50 text-sky-300',
  DISPUTE: 'bg-orange-900/40 border-orange-700/50 text-orange-300',
  WRITE_OFF: 'bg-red-900/40 border-red-700/50 text-red-300',
}
const DECISION_LABEL: Record<string, string> = {
  STILL_OWED: 'Still owed',
  DISPUTE: 'Dispute',
  WRITE_OFF: 'Write off',
  PAID: 'Paid',
}

export default function AgingReviewPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [writeOffs, setWriteOffs] = useState<WriteOff[]>([])
  const [canWriteOff, setCanWriteOff] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [pendingDecision, setPendingDecision] = useState<string>('')

  const load = useCallback(() => {
    fetch('/api/collections/aging-review')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setRows(d.rows ?? [])
          setWriteOffs(d.writeOffs ?? [])
          setCanWriteOff(d.canWriteOff === true)
        }
      })
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const toggleInsurance = useCallback(
    async (r: Row) => {
      const on = !r.insurance
      let claimNumber: string | undefined
      if (on) {
        claimNumber = window.prompt('Carrier claim # (optional — leave blank if none yet)') ?? undefined
        if (claimNumber === undefined) {
          // prompt cancelled — user backed out entirely
        }
      }
      await fetch('/api/collections/rw-invoices/insurance-flag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rwInvoiceId: r.rwInvoiceId, on, claimNumber: claimNumber || undefined }),
      })
      load()
    },
    [load],
  )

  const decide = useCallback(
    async (rwInvoiceId: string, decision: string, note?: string) => {
      setSaving(rwInvoiceId)
      try {
        // PAID goes through the one mechanism that already exists for it —
        // the row then leaves this list because paid-marks are excluded.
        const r =
          decision === 'PAID'
            ? await fetch('/api/rentalworks/invoices/mark-paid', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rwInvoiceId, note }),
              })
            : await fetch('/api/collections/aging-review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rwInvoiceId, decision, note }),
              })
        if ((await r.json()).ok) {
          setNoteFor(null)
          setNoteDraft('')
          load()
        }
      } finally {
        setSaving(null)
      }
    },
    [load],
  )

  const undecided = rows.filter((r) => !r.triage)
  const undecidedTotal = undecided.reduce((s, r) => s + r.remainingTotal, 0)
  const writeOffTotal = writeOffs.reduce((s, w) => s + w.amount, 0)
  const byYear = new Map<number, number>()
  for (const w of writeOffs) {
    const y = new Date(w.decidedAt).getFullYear()
    byYear.set(y, (byYear.get(y) ?? 0) + w.amount)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold text-white">Aging Review</h1>
      <p className="text-sm text-zinc-400 mt-1 mb-6">
        Every open invoice past 60 days, oldest first. Rule on each one — decisions feed the
        Outstanding number, and write-offs become the bad-debt ledger below.
      </p>

      {loading ? (
        <div className="text-zinc-500 text-sm">Loading…</div>
      ) : (
        <>
          <div className="text-xs text-zinc-400 mb-4">
            {rows.length} invoice{rows.length === 1 ? '' : 's'} past 60 days ·{' '}
            {undecided.length} undecided ({money(undecidedTotal)})
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl divide-y divide-zinc-800 mb-8">
            {rows.length === 0 && (
              <div className="p-6 text-sm text-zinc-500">Nothing past 60 days. Good book.</div>
            )}
            {rows.map((r) => (
              <div key={r.rwInvoiceId} className="p-4">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-white">{r.invoiceNumber || '(no number)'}</span>
                    <span className={`ml-2 text-xs font-semibold ${r.ageDays > 90 ? 'text-red-400' : 'text-orange-400'}`}>
                      {r.ageDays}d
                    </span>
                    {r.insurance && (
                      <span
                        className="ml-2 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-900/40 border border-violet-700/50 text-violet-300"
                        title={r.insurance.claimNumber ? `Carrier claim ${r.insurance.claimNumber}` : 'Awaiting insurance carrier'}
                      >
                        Insurance{r.insurance.claimNumber ? ` · ${r.insurance.claimNumber}` : ''}
                      </span>
                    )}
                    <div className="text-xs text-zinc-400 mt-0.5 truncate">
                      {r.customerName || '—'}
                      {r.dealName ? ` · ${r.dealName}` : ''}
                      {r.agent ? ` · ${r.agent}` : ''}
                      {r.invoiceDate ? ` · invoiced ${new Date(r.invoiceDate).toLocaleDateString()}` : ''}
                    </div>
                    {r.receivedTotal > 0 && (
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {money(r.receivedTotal)} of {money(r.invoiceTotal)} received — balance is the remainder
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm text-amber-500 font-semibold">{money(r.remainingTotal)}</div>
                    <span
                      role="button"
                      onClick={() => void toggleInsurance(r)}
                      className="text-[11px] text-zinc-500 hover:text-violet-300 cursor-pointer"
                      title={r.insurance ? 'Unmark — this is back to waiting on the client' : 'Mark as waiting on an insurance carrier'}
                    >
                      {r.insurance ? 'not insurance' : 'insurance?'}
                    </span>
                  </div>
                </div>

                {r.triage ? (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${DECISION_STYLE[r.triage.decision] ?? 'border-zinc-700 text-zinc-300'}`}>
                      {DECISION_LABEL[r.triage.decision] ?? r.triage.decision}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {r.triage.decidedBy ?? 'someone'} · {new Date(r.triage.decidedAt).toLocaleDateString()}
                      {r.triage.note ? ` — ${r.triage.note}` : ''}
                    </span>
                    {(r.triage.decision !== 'WRITE_OFF' || canWriteOff) && (
                      <span
                        role="button"
                        onClick={() => decide(r.rwInvoiceId, 'CLEAR')}
                        className="text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                      >
                        undo
                      </span>
                    )}
                  </div>
                ) : noteFor === r.rwInvoiceId ? (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      autoFocus
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder={
                        pendingDecision === 'WRITE_OFF'
                          ? 'Why is this uncollectible? (goes in the tax record)'
                          : pendingDecision === 'PAID'
                            ? 'How was it paid? wire ref / check # (optional)'
                            : 'Note (optional)'
                      }
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-amber-600"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void decide(r.rwInvoiceId, pendingDecision, noteDraft)
                        if (e.key === 'Escape') setNoteFor(null)
                      }}
                    />
                    <button
                      onClick={() => void decide(r.rwInvoiceId, pendingDecision, noteDraft)}
                      disabled={saving === r.rwInvoiceId || (pendingDecision === 'WRITE_OFF' && !noteDraft.trim())}
                      className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-semibold"
                    >
                      {saving === r.rwInvoiceId ? 'Saving…' : `Save ${DECISION_LABEL[pendingDecision]?.toLowerCase() ?? ''}`}
                    </button>
                    <button onClick={() => setNoteFor(null)} className="text-xs text-zinc-500 hover:text-zinc-300">
                      cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {(['PAID', 'STILL_OWED', 'DISPUTE'] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => {
                          setNoteFor(r.rwInvoiceId)
                          setPendingDecision(d)
                          setNoteDraft('')
                        }}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded border cursor-pointer hover:brightness-125 ${
                          d === 'PAID'
                            ? 'bg-emerald-900/40 border-emerald-700/50 text-emerald-300'
                            : DECISION_STYLE[d]
                        }`}
                      >
                        {DECISION_LABEL[d]}
                      </button>
                    ))}
                    {canWriteOff ? (
                      <button
                        onClick={() => {
                          setNoteFor(r.rwInvoiceId)
                          setPendingDecision('WRITE_OFF')
                          setNoteDraft('')
                        }}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded border cursor-pointer hover:brightness-125 ${DECISION_STYLE.WRITE_OFF}`}
                      >
                        Write off
                      </button>
                    ) : (
                      <span className="text-[11px] text-zinc-600" title="A write-off is a tax event — flag it as Dispute and Wes will rule on it.">
                        write-off: Wes only
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Write-off ledger — the bad-debt tax list. */}
          <div className="bg-zinc-900 border border-red-900/50 rounded-xl p-5">
            <h2 className="text-sm font-bold text-white mb-1">Write-off ledger</h2>
            <p className="text-xs text-zinc-400 mb-3">
              Deemed uncollectible — {writeOffs.length} invoice{writeOffs.length === 1 ? '' : 's'},{' '}
              {money(writeOffTotal)} total
              {[...byYear.entries()].map(([y, amt]) => ` · ${y}: ${money(amt)}`).join('')}.
              This list, with dates and notes, is what goes to the CPA — whether bad debt is
              deductible depends on SirReel&rsquo;s accounting method (accrual can deduct,
              cash-basis generally cannot), so confirm treatment before filing.
            </p>
            {writeOffs.length === 0 ? (
              <p className="text-sm text-zinc-500">Nothing written off yet.</p>
            ) : (
              <div className="divide-y divide-zinc-800">
                {writeOffs.map((w) => (
                  <div key={w.rwInvoiceId} className="py-2 flex justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <span className="text-white font-semibold">{w.invoiceNumber || '(no number)'}</span>
                      <span className="text-zinc-400"> · {w.customerName || '—'}</span>
                      <div className="text-xs text-zinc-500">
                        {new Date(w.decidedAt).toLocaleDateString()} · {w.decidedBy ?? '—'}
                        {w.note ? ` — ${w.note}` : ''}
                      </div>
                    </div>
                    <span className="text-red-400 font-semibold shrink-0">{money(w.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
