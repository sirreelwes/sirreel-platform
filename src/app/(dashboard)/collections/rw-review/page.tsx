'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * /collections/rw-review — the aging RentalWorks invoice review desk.
 *
 * Wes, 2026-09-02: "let's create a dedicated aging RW invoices for review by
 * Ana and Admin. It will have notes on every Invoice, as well as the emails we
 * have referenced and summary of what AI thinks about whether it has been
 * paid."
 *
 * ── Why this is not the existing /collections/aging-review ────────────────
 *
 * That page is a fast triage worklist: rule Still owed / Dispute / Write off
 * and move on. This is the reading room behind it — the email trail and what
 * it appears to say — and the two want opposite layouts. Triage wants one line
 * per invoice and a keyboard. Review wants the evidence open in front of you.
 * Rulings still belong on the triage page; this one links to it.
 *
 * ── What the desk is actually for ─────────────────────────────────────────
 *
 * Measured 2026-09-02: 77 of 89 open invoices reach no HQ job at all,
 * carrying $117,720 of the $132,653 outstanding — so for most of this money
 * HQ holds no job, no order, no contacts. The email trail is the only context
 * that exists, which is why it is the page rather than a detail popover.
 *
 * The AI verdict is advisory and labelled as such. It reads the thread and
 * says what it appears to show; nothing here moves money or clears a balance.
 */

interface EvidenceHit {
  tier: 'STRONG' | 'LIKELY' | 'WEAK'
  gmailMessageId: string
  subject: string | null
  fromAddress: string
  direction: string | null
  sentAt: string
  excerpt: string
}

interface Row {
  rwInvoiceId: string
  invoiceNumber: string | null
  orderNumber: string | null
  dealName: string | null
  customerName: string | null
  agent: string | null
  remaining: number
  invoiceDate: string | null
  ageDays: number | null
  job: { jobId: string; jobCode: string; name: string } | null
  note: string | null
  noteBy: string | null
  aiVerdict: string | null
  aiConfidence: number | null
  aiSummary: string | null
  evidence: EvidenceHit[]
  evidenceCount: number
  scannedAt: string | null
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const VERDICT: Record<string, { label: string; cls: string }> = {
  LIKELY_PAID: { label: 'Looks paid — check', cls: 'bg-emerald-50 text-emerald-700 border-emerald-300' },
  DISPUTED: { label: 'Disputed', cls: 'bg-orange-50 text-orange-700 border-orange-300' },
  INSURANCE: { label: 'Insurance / claim', cls: 'bg-sky-50 text-sky-700 border-sky-300' },
  LIKELY_OPEN: { label: 'Still owed', cls: 'bg-zinc-100 text-zinc-600 border-zinc-300' },
  NO_EVIDENCE: { label: 'No email found', cls: 'bg-zinc-50 text-zinc-500 border-zinc-200' },
}

const TIER: Record<string, string> = {
  STRONG: 'bg-zinc-800 text-white',
  LIKELY: 'bg-zinc-300 text-zinc-800',
  WEAK: 'bg-zinc-100 text-zinc-500',
}

/** Verdicts that mean "this one is not an ordinary chase" — the reason to open
 *  the page at all. Sorted to the top. */
const INTERESTING = new Set(['LIKELY_PAID', 'DISPUTED', 'INSURANCE'])

export default function RwReviewPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [totals, setTotals] = useState<{ count: number; remaining: number; unscanned: number; noJob: number } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [savingNote, setSavingNote] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<'all' | 'flagged' | 'unscanned' | 'nojob'>('all')
  // Date first by default (Wes, 2026-09-02: "organize them all by date").
  // Oldest invoice at the top — the aging worklist reading.
  const [sort, setSort] = useState<'date' | 'attention' | 'amount'>('date')
  const [marking, setMarking] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch('/api/collections/rw-review', { cache: 'no-store' })
    if (!r.ok) return
    const j = await r.json()
    setRows(j.rows)
    setTotals(j.totals)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const scan = async (rwInvoiceId?: string) => {
    setScanning(true)
    try {
      await fetch('/api/collections/rw-review/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rwInvoiceId ? { rwInvoiceId } : { limit: 5 }),
      })
      await load()
    } finally {
      setScanning(false)
    }
  }

  /**
   * Clear an invoice from HQ's AR. Wes, 2026-09-02: "it doesn't affect RW" —
   * correct, this writes an HQ-side override only, and it is reversible.
   *
   * Goes through the EXISTING mark-paid route rather than a second write path,
   * so "paid" means one thing across the review desk, the aging review and the
   * invoice list. The note carries the AI's reasoning and confidence, because
   * six months from now the difference between "Ana confirmed the wire" and
   * "a model inferred it from an email" is the whole story.
   */
  const markPaid = async (r: Row) => {
    const label = `${r.customerName ?? 'this client'} · ${usd(r.remaining)}`
    if (!window.confirm(`Clear ${label} from HQ collections?\n\nRentalWorks is not touched, and this can be undone.`)) return
    setMarking(r.rwInvoiceId)
    try {
      const provenance = r.aiSummary
        ? `Cleared from the review desk. AI read (${Math.round((r.aiConfidence ?? 0) * 100)}% confident): ${r.aiSummary}`
        : 'Cleared from the review desk.'
      await fetch('/api/rentalworks/invoices/mark-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rwInvoiceId: r.rwInvoiceId, note: provenance.slice(0, 500) }),
      })
      await load()
    } finally {
      setMarking(null)
    }
  }

  const saveNote = async (rwInvoiceId: string) => {
    setSavingNote(rwInvoiceId)
    try {
      await fetch('/api/collections/rw-review/note', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rwInvoiceId, note: noteDraft[rwInvoiceId] ?? '' }),
      })
      await load()
    } finally {
      setSavingNote(null)
    }
  }

  const visible = (rows ?? [])
    .filter((r) =>
      filter === 'flagged' ? INTERESTING.has(r.aiVerdict ?? '')
        : filter === 'unscanned' ? !r.scannedAt
          : filter === 'nojob' ? !r.job
            : true,
    )
    .sort((a, b) => {
      if (sort === 'amount') return b.remaining - a.remaining
      if (sort === 'attention') {
        const ai = INTERESTING.has(a.aiVerdict ?? '') ? 0 : 1
        const bi = INTERESTING.has(b.aiVerdict ?? '') ? 0 : 1
        if (ai !== bi) return ai - bi
      }
      // Oldest invoice first. Undated rows sort last rather than to 1970.
      const at = a.invoiceDate ? +new Date(a.invoiceDate) : Number.POSITIVE_INFINITY
      const bt = b.invoiceDate ? +new Date(b.invoiceDate) : Number.POSITIVE_INFINITY
      return at - bt
    })

  return (
    <div className="bg-lt-page -m-3 min-h-[calc(100vh-3rem)] p-4 md:-m-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold text-zinc-900">Aging RW invoices · review</h1>
              <p className="mt-1 max-w-2xl text-[13.5px] text-zinc-600">
                Every open RentalWorks invoice with the email trail behind it, and what that trail
                appears to say. Read it, add a note, then rule on the{' '}
                <a href="/collections/aging-review" className="font-semibold underline underline-offset-2">
                  aging review
                </a>
                .
              </p>
            </div>
            <a href="/collections" className="text-[12px] font-semibold text-zinc-600 hover:text-zinc-900">
              ← Collections
            </a>
          </div>

          {totals && (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
              <span className="text-zinc-600">
                <span className="text-[15px] font-bold text-amber-700 tabular-nums">{usd(totals.remaining)}</span>{' '}
                across {totals.count} invoices
              </span>
              <span className="text-zinc-600">
                <span className="font-semibold text-zinc-900 tabular-nums">{totals.noJob}</span> reach no HQ job
              </span>
              {totals.unscanned > 0 && (
                <span className="text-zinc-600">
                  <span className="font-semibold text-zinc-900 tabular-nums">{totals.unscanned}</span> not yet read
                </span>
              )}
              <button
                onClick={() => void scan()}
                disabled={scanning || totals.unscanned === 0}
                className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 disabled:opacity-40 text-white text-[12px] font-semibold"
              >
                {scanning ? 'Reading…' : totals.unscanned === 0 ? 'All read' : 'Read next 5'}
              </button>
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {([
              ['all', 'All'],
              ['flagged', 'Needs a look'],
              ['nojob', 'No HQ job'],
              ['unscanned', 'Not yet read'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold border ${
                  filter === k ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-600 border-zinc-300 hover:border-zinc-400'
                }`}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-400">Sort</span>
              {([
                ['date', 'Oldest first'],
                ['attention', 'Needs a look'],
                ['amount', 'Largest'],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setSort(k)}
                  className={`px-2 py-1 rounded-lg text-[11.5px] font-semibold ${
                    sort === k ? 'bg-zinc-200 text-zinc-900' : 'text-zinc-500 hover:text-zinc-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </span>
          </div>
        </header>

        {!rows ? (
          <p className="text-[13px] text-zinc-500">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-[13px] text-zinc-500">Nothing here.</p>
        ) : (
          <div className="space-y-2">
            {visible.map((r) => {
              const v = r.aiVerdict ? VERDICT[r.aiVerdict] : null
              const isOpen = openId === r.rwInvoiceId
              return (
                <div key={r.rwInvoiceId} className="rounded-xl border border-zinc-200 bg-white">
                  <button
                    onClick={() => setOpenId(isOpen ? null : r.rwInvoiceId)}
                    className="w-full text-left p-3.5 flex items-start gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-semibold text-zinc-900">{r.customerName ?? 'Unknown client'}</span>
                        {r.dealName && <span className="text-[13px] text-zinc-500">· {r.dealName}</span>}
                        {v && (
                          <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${v.cls}`}>
                            {v.label}
                          </span>
                        )}
                        {!r.job && (
                          <span
                            className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700"
                            title="No HQ job is linked to this invoice — email is the only context we hold."
                          >
                            no job
                          </span>
                        )}
                        {r.note && <span title="Has a note">📝</span>}
                      </div>
                      <div className="mt-0.5 text-[12px] text-zinc-500">
                        <span className="font-semibold text-zinc-700 tabular-nums">
                          {r.invoiceDate ? new Date(r.invoiceDate).toISOString().slice(0, 10) : 'no date'}
                        </span>
                        {' · '}Inv {r.invoiceNumber ?? '—'} · order {r.orderNumber ?? '—'}
                        {r.ageDays !== null && <> · {r.ageDays} days old</>}
                        {r.agent && <> · {r.agent}</>}
                        {r.evidenceCount > 0 && <> · {r.evidenceCount} emails</>}
                      </div>
                      {r.aiSummary && !isOpen && (
                        <p className="mt-1.5 text-[12.5px] leading-snug text-zinc-600 line-clamp-2">{r.aiSummary}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[15px] font-bold text-amber-700 tabular-nums">{usd(r.remaining)}</div>
                      <div className="text-[11px] text-zinc-400">{isOpen ? 'close' : 'open'}</div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-zinc-100 p-3.5 space-y-3">
                      {r.aiSummary ? (
                        <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">
                            What the emails appear to say
                            {r.aiConfidence !== null && <> · {Math.round(r.aiConfidence * 100)}% confident</>}
                          </div>
                          <p className="text-[13px] leading-relaxed text-zinc-700">{r.aiSummary}</p>
                          <p className="mt-1.5 text-[11px] text-zinc-400">
                            An AI reading of the thread below — not a record of payment. Verify before acting.
                          </p>
                        </div>
                      ) : (
                        <button
                          onClick={() => void scan(r.rwInvoiceId)}
                          disabled={scanning}
                          className="px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 disabled:opacity-40 text-[12px] font-semibold text-zinc-800"
                        >
                          {scanning ? 'Reading…' : 'Read the emails for this invoice'}
                        </button>
                      )}

                      {r.evidence.length > 0 && (
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1.5">
                            Emails referenced
                          </div>
                          <div className="space-y-1.5">
                            {r.evidence.map((e) => (
                              <div key={e.gmailMessageId} className="rounded-lg border border-zinc-200 p-2.5">
                                <div className="flex items-center gap-2 flex-wrap text-[11.5px]">
                                  <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded ${TIER[e.tier]}`}>
                                    {e.tier}
                                  </span>
                                  <span className="font-semibold text-zinc-800">{e.fromAddress}</span>
                                  <span className="text-zinc-400">{String(e.sentAt).slice(0, 10)}</span>
                                </div>
                                <div className="mt-0.5 text-[12.5px] font-medium text-zinc-800">{e.subject ?? '(no subject)'}</div>
                                <p className="mt-1 text-[12px] leading-snug text-zinc-600">{e.excerpt}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 block mb-1">
                          Note {r.noteBy && <span className="normal-case tracking-normal font-medium">· last by {r.noteBy}</span>}
                        </label>
                        <textarea
                          value={noteDraft[r.rwInvoiceId] ?? r.note ?? ''}
                          onChange={(e) => setNoteDraft((d) => ({ ...d, [r.rwInvoiceId]: e.target.value }))}
                          rows={2}
                          placeholder="Who you spoke to, what they said, what happens next."
                          className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[12.5px] text-zinc-900 outline-none focus:border-zinc-900"
                        />
                        <div className="mt-1.5 flex items-center gap-2">
                          <button
                            onClick={() => void saveNote(r.rwInvoiceId)}
                            disabled={savingNote === r.rwInvoiceId}
                            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-[12px] font-semibold"
                          >
                            {savingNote === r.rwInvoiceId ? 'Saving…' : 'Save note'}
                          </button>
                          {r.scannedAt && (
                            <button
                              onClick={() => void scan(r.rwInvoiceId)}
                              disabled={scanning}
                              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-zinc-500 hover:text-zinc-900 disabled:opacity-40"
                            >
                              Re-read emails
                            </button>
                          )}
                          <button
                            onClick={() => void markPaid(r)}
                            disabled={marking === r.rwInvoiceId}
                            title="Clears it from HQ collections only. RentalWorks is untouched, and it can be undone."
                            className="px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 text-[12px] font-semibold text-emerald-700"
                          >
                            {marking === r.rwInvoiceId ? 'Clearing…' : 'Mark paid in HQ'}
                          </button>
                          <a
                            href="/collections/aging-review"
                            className="ml-auto text-[12px] font-semibold text-zinc-600 hover:text-zinc-900"
                          >
                            Rule on it →
                          </a>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
