'use client'

/**
 * /ap — accounts payable, read out of email.
 *
 * Wes, 2026-09-08: "all the emails that show invoices coming from vendors,
 * and try to cross-check with purchase orders that you find created by
 * someone on the SirReel team."
 *
 * ── What this is ──────────────────────────────────────────────────────────
 * A reading desk, not a ledger. HQ has never held one payable — bills arrive
 * as PDFs in five mailboxes and get paid from memory. This finds them, reads
 * what is on them, and puts each one next to whatever the team committed to
 * on our side: a sub-rental carrying that PO number, or the outbound email
 * that issued it. Most SirReel POs have only ever existed as that email,
 * which is why both count.
 *
 * ── What it deliberately does not do ──────────────────────────────────────
 * Nothing here approves, schedules or records a payment, and no total on
 * this page is an amount owed — it is an amount *billed*, as read off
 * documents by a model. The two states worth opening the page for are
 * "cites a PO nobody here issued" and "the amount doesn't match what we
 * agreed"; everything else is context for those.
 *
 * Server-allowlisted (src/lib/ap/allowlist.ts — Wes only). The nav row is
 * hidden for everyone else, and the page doesn't trust the nav: every API
 * call re-checks, and a 403 renders Forbidden. Same shape as /payroll.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

interface PoCandidate {
  source: 'SUB_RENTAL' | 'EMAIL_PO'
  tier: 'EXACT_PO' | 'VENDOR_AMOUNT' | 'VENDOR_WINDOW'
  refId: string
  label: string
  poNumber: string | null
  vendorName: string | null
  amount: number | null
  dates: string | null
  createdBy: string | null
  why: string
}

interface Row {
  id: string
  gmailMessageId: string
  inbox: string
  sentAt: string
  fromAddress: string
  subject: string
  vendorName: string | null
  vendorDomain: string | null
  vendorId: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  dueDate: string | null
  amountTotal: number | null
  currency: string | null
  terms: string | null
  poNumberRaw: string | null
  jobReference: string | null
  lineSummary: string | null
  attachmentNames: string[]
  readPdf: boolean
  isBill: boolean
  aiSummary: string | null
  aiConfidence: number | null
  matchStatus: 'MATCHED' | 'AMOUNT_MISMATCH' | 'PO_NOT_FOUND' | 'NO_PO_ON_BILL' | 'NO_CANDIDATES'
  matchedPoSource: string | null
  matchNote: string | null
  poCandidates: PoCandidate[]
  reviewState: 'NEW' | 'OK' | 'QUESTION' | 'NOT_A_BILL'
  reviewNote: string | null
  reviewedAt: string | null
}

interface Totals {
  bills: number
  billed: number
  needsAnswer: number
  needsAnswerAmount: number
  unmatched: number
  unread: number
  windowDays: number
}

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'

/** The chip carries the whole verdict, so it says what it means rather than
 *  naming the enum. PO_NOT_FOUND and AMOUNT_MISMATCH are the loud ones. */
const MATCH: Record<Row['matchStatus'], { label: string; cls: string }> = {
  PO_NOT_FOUND: { label: 'PO we never issued', cls: 'bg-chip-bad-bg text-chip-bad-fg border-chip-bad-fg/25' },
  AMOUNT_MISMATCH: { label: "Amount doesn't match", cls: 'bg-chip-warn-bg text-chip-warn-fg border-chip-warn-fg/25' },
  MATCHED: { label: 'Matched to a PO', cls: 'bg-chip-good-bg text-chip-good-fg border-chip-good-fg/25' },
  NO_PO_ON_BILL: { label: 'No PO on the bill', cls: 'bg-chip-neutral-bg text-chip-neutral-fg border-chip-muted-border' },
  NO_CANDIDATES: { label: 'Nothing on our side', cls: 'bg-lt-inner text-lt-fg3 border-lt-hairline' },
}

const NEEDS_ANSWER = new Set<Row['matchStatus']>(['PO_NOT_FOUND', 'AMOUNT_MISMATCH'])

type Filter = 'attention' | 'all' | 'matched' | 'nopo' | 'notbill'

const FILTERS: [Filter, string][] = [
  ['attention', 'Needs an answer'],
  ['all', 'All bills'],
  ['matched', 'Matched'],
  ['nopo', 'No PO'],
  ['notbill', 'Not a bill'],
]

export default function AccountsPayablePage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [totals, setTotals] = useState<Totals | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('attention')
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})
  const [lastScan, setLastScan] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/ap/bills', { cache: 'no-store' })
    if (res.status === 401 || res.status === 403) {
      setForbidden(true)
      return
    }
    if (!res.ok) return
    const j = await res.json()
    setRows(j.rows)
    setTotals(j.totals)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const scan = async () => {
    setScanning(true)
    setLastScan(null)
    try {
      const res = await fetch('/api/ap/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 8 }),
      })
      if (res.status === 401 || res.status === 403) {
        setForbidden(true)
        return
      }
      const j = await res.json()
      setLastScan(
        j.read?.length
          ? `Read ${j.read.length} — ${j.bills} bill${j.bills === 1 ? '' : 's'}, ${j.notBills} not.`
          : 'Nothing left to read in this window.',
      )
      await load()
    } finally {
      setScanning(false)
    }
  }

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id)
    try {
      await fetch(`/api/ap/bills/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const visible = useMemo(() => {
    const all = rows ?? []
    return all.filter((r) => {
      if (filter === 'notbill') return !r.isBill || r.reviewState === 'NOT_A_BILL'
      if (!r.isBill || r.reviewState === 'NOT_A_BILL') return false
      if (filter === 'attention') return NEEDS_ANSWER.has(r.matchStatus)
      if (filter === 'matched') return r.matchStatus === 'MATCHED'
      if (filter === 'nopo') return r.matchStatus === 'NO_PO_ON_BILL' || r.matchStatus === 'NO_CANDIDATES'
      return true
    })
  }, [rows, filter])

  if (forbidden) {
    return (
      <div className="bg-lt-page -m-3 min-h-[calc(100vh-3rem)] p-4 md:-m-4 md:p-6">
        <div className="mx-auto max-w-lg rounded-xl border border-lt-hairline bg-lt-card p-6">
          <h1 className="text-lg font-semibold text-lt-fg">Accounts payable is restricted</h1>
          <p className="mt-2 text-[13px] text-lt-fg2">
            This desk shows vendor pricing and sub-rental cost against client billing, so access is
            granted by name rather than by role.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-lt-page -m-3 min-h-[calc(100vh-3rem)] p-4 md:-m-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold text-lt-fg">Accounts payable</h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-lt-fg2">
            Vendor invoices found in SirReel&apos;s mailboxes, each read off its own PDF and set
            against the purchase orders our team created — a sub-rental carrying that PO number, or
            the email someone here sent to issue it. Nothing on this page pays, approves or
            schedules anything.
          </p>

          {totals && (
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
              <span className="text-lt-fg2">
                <span className="text-[15px] font-bold text-lt-fg tabular-nums">{usd(totals.billed)}</span>{' '}
                billed across {totals.bills} invoice{totals.bills === 1 ? '' : 's'}
              </span>
              {totals.needsAnswer > 0 && (
                <span className="text-lt-fg2">
                  <span className="font-semibold text-chip-bad-fg tabular-nums">{totals.needsAnswer}</span> need an
                  answer <span className="text-lt-fg3 tabular-nums">({usd(totals.needsAnswerAmount)})</span>
                </span>
              )}
              <span className="text-lt-fg2">
                <span className="font-semibold text-lt-fg tabular-nums">{totals.unmatched}</span> with no PO
              </span>
              <button
                onClick={() => void scan()}
                disabled={scanning || totals.unread === 0}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
              >
                {scanning
                  ? 'Reading…'
                  : totals.unread === 0
                    ? 'All read'
                    : `Read next 8 of ${totals.unread}`}
              </button>
              <span className="text-lt-fg3">last {totals.windowDays} days</span>
            </div>
          )}
          {lastScan && <p className="mt-2 text-[12px] text-lt-fg3">{lastScan}</p>}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {FILTERS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${
                  filter === k
                    ? 'border-lt-fg bg-lt-fg text-white'
                    : 'border-lt-hairline bg-lt-card text-lt-fg2 hover:border-lt-fg3'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {rows === null && <p className="text-[13px] text-lt-fg3">Loading…</p>}

        {rows !== null && visible.length === 0 && (
          <div className="rounded-xl border border-lt-hairline bg-lt-card p-6 text-[13px] text-lt-fg2">
            {rows.length === 0 ? (
              <>
                Nothing read yet. Press <span className="font-semibold">Read next 8</span> to start on the
                candidate emails — each one costs a document read, so the desk works through them a
                batch at a time.
              </>
            ) : (
              <>Nothing in this filter.</>
            )}
          </div>
        )}

        <div className="space-y-2">
          {visible.map((r) => {
            const open = openId === r.id
            const chip = MATCH[r.matchStatus]
            return (
              <article key={r.id} className="rounded-xl border border-lt-hairline bg-lt-card">
                <button
                  onClick={() => setOpenId(open ? null : r.id)}
                  className="flex w-full items-start gap-3 p-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold text-lt-fg">
                        {r.vendorName ?? r.vendorDomain ?? r.fromAddress}
                      </span>
                      {r.invoiceNumber && (
                        <span className="font-mono text-[11.5px] text-lt-fg3">#{r.invoiceNumber}</span>
                      )}
                      <span className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${chip.cls}`}>
                        {chip.label}
                      </span>
                      {r.reviewState !== 'NEW' && (
                        <span className="rounded-md border border-lt-hairline bg-lt-inner px-1.5 py-0.5 text-[11px] font-semibold text-lt-fg3">
                          {r.reviewState === 'OK' ? 'cleared' : r.reviewState === 'QUESTION' ? 'question' : 'not a bill'}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[12.5px] text-lt-fg2">{r.subject || '(no subject)'}</p>
                    <p className="mt-0.5 text-[11.5px] text-lt-fg3">
                      {day(r.sentAt)} · {r.inbox}
                      {r.poNumberRaw ? ` · cites PO ${r.poNumberRaw}` : ' · no PO cited'}
                      {r.jobReference ? ` · ${r.jobReference}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[15px] font-bold text-lt-fg tabular-nums">
                      {r.amountTotal === null ? '—' : usd(r.amountTotal)}
                    </div>
                    {r.dueDate && <div className="text-[11px] text-lt-fg3">due {day(r.dueDate)}</div>}
                  </div>
                </button>

                {open && (
                  <div className="space-y-3 border-t border-lt-hairline p-3">
                    {r.aiSummary && (
                      <p className="text-[12.5px] text-lt-fg2">
                        {r.aiSummary}
                        {r.aiConfidence !== null && (
                          <span className="text-lt-fg3"> · {Math.round(r.aiConfidence * 100)}% confident</span>
                        )}
                      </p>
                    )}

                    {!r.readPdf && (
                      <p className="rounded-lg bg-chip-warn-bg px-2.5 py-1.5 text-[11.5px] text-chip-warn-fg">
                        Read from the email text only — no PDF was opened. If the numbers live in an
                        attachment, they are not on this row. Open it in Gmail before acting on it.
                      </p>
                    )}

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-3">
                      {([
                        ['From', r.fromAddress],
                        ['Invoice date', day(r.invoiceDate)],
                        ['Due', r.dueDate ? day(r.dueDate) : r.terms ?? '—'],
                        ['Terms', r.terms ?? '—'],
                        ['For', r.lineSummary ?? '—'],
                        ['Attachments', r.attachmentNames.length ? r.attachmentNames.join(', ') : 'none'],
                      ] as [string, string][]).map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-[10.5px] uppercase tracking-wide text-lt-fg3">{k}</dt>
                          <dd className="break-words text-lt-fg2">{v}</dd>
                        </div>
                      ))}
                    </dl>

                    <div className="rounded-lg bg-lt-inner p-2.5">
                      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-lt-fg3">
                        Against our purchase orders
                      </p>
                      {r.matchNote && <p className="mt-1 text-[12.5px] text-lt-fg">{r.matchNote}</p>}
                      {r.poCandidates.length > 0 && (
                        <ul className="mt-2 space-y-1.5">
                          {r.poCandidates.map((c, i) => (
                            <li key={`${c.refId}-${i}`} className="text-[12px]">
                              <span className="font-semibold text-lt-fg">{c.label}</span>
                              {c.amount !== null && (
                                <span className="text-lt-fg2 tabular-nums"> · we agreed {usd(c.amount)}</span>
                              )}
                              {c.dates && <span className="text-lt-fg3"> · {c.dates}</span>}
                              <span className="block text-[11.5px] text-lt-fg3">
                                {c.source === 'EMAIL_PO' ? 'email PO' : 'sub-rental'} · {c.why}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <button
                        onClick={() => void patch(r.id, { rematch: true })}
                        disabled={busyId === r.id}
                        className="mt-2 text-[11.5px] font-semibold text-lt-fg2 underline underline-offset-2 hover:text-lt-fg disabled:opacity-40"
                      >
                        Re-check against POs
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {([
                        ['OK', 'Nothing to chase'],
                        ['QUESTION', 'Ask about this'],
                        ['NOT_A_BILL', 'Not a bill'],
                      ] as [Row['reviewState'], string][]).map(([state, label]) => (
                        <button
                          key={state}
                          onClick={() => void patch(r.id, { reviewState: r.reviewState === state ? 'NEW' : state })}
                          disabled={busyId === r.id}
                          className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-40 ${
                            r.reviewState === state
                              ? 'border-lt-fg bg-lt-fg text-white'
                              : 'border-lt-hairline bg-lt-card text-lt-fg2 hover:border-lt-fg3'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                      <a
                        href={`https://mail.google.com/mail/u/${encodeURIComponent(r.inbox)}/#all/${encodeURIComponent(r.gmailMessageId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-[11.5px] font-semibold text-lt-fg2 underline underline-offset-2 hover:text-lt-fg"
                      >
                        Open in Gmail ({r.inbox})
                      </a>
                    </div>

                    <div className="flex gap-2">
                      <input
                        value={noteDraft[r.id] ?? r.reviewNote ?? ''}
                        onChange={(e) => setNoteDraft({ ...noteDraft, [r.id]: e.target.value })}
                        placeholder="Note to yourself"
                        className="flex-1 rounded-lg border border-lt-hairline bg-lt-card px-2.5 py-1.5 text-[12px] text-lt-fg placeholder:text-lt-fg3"
                      />
                      <button
                        onClick={() => void patch(r.id, { reviewNote: noteDraft[r.id] ?? '' })}
                        disabled={busyId === r.id || noteDraft[r.id] === undefined}
                        className="rounded-lg bg-lt-fg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
