'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * "Send EOD Report" — the end-of-day collections summary, from HQ.
 *
 * Wes, 2026-09-02: "Ana usually sends an end of day collections report. Let's
 * make that automated... Allow her to press 'Send EOD Report' (That report
 * goes to Dani and Wes) for now."
 *
 * The four figures arrive pre-filled from HQ and stay editable, because HQ can
 * only honestly compute some of them — the reasoning is in
 * src/lib/collections/eodReport.ts, and each field carries its own provenance
 * line here so Ana can see which numbers to trust at a glance.
 *
 * "for now" is doing real work in that quote: this is the manual trigger. The
 * figures, the template and the recipient channel are all reusable by a
 * scheduled 6pm send later, and nothing here has to change for that.
 */

interface Figure {
  amount: number
  count: number
  source: string
  partial: boolean
}

interface EodData {
  figures: {
    date: string
    cardpointe: Figure
    rentalworks: Figure
    ordersCreated: Figure
    quotesCreated: Figure
    context: {
      otherReceipts: number
      achPending: number
      achPendingCount: number
      outstandingTotal: number
      outstandingCount: number
      rwObservedPaid: number
      rwObservedCount: number
    }
  }
  recipients: string[]
  alreadySentAt: string | null
  alreadySentBy: string | null
}

type FieldKey = 'cardpointe' | 'rentalworks' | 'ordersCreated' | 'quotesCreated'

// Total before its parts, matching the email. RentalWorks is the day's whole
// take and CardPointe is the card slice of it (Wes, 2026-09-02) — listing the
// card figure first invited reading them as two separate piles.
const FIELDS: { key: FieldKey; label: string }[] = [
  { key: 'rentalworks', label: 'Collected today (RentalWorks)' },
  { key: 'cardpointe', label: 'of which card (CardPointe)' },
  { key: 'ordersCreated', label: 'Value of orders created' },
  { key: 'quotesCreated', label: 'Value of quotes created' },
]

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function timeAgoLabel(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function EodReportPanel() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<EodData | null>(null)
  const [vals, setVals] = useState<Record<FieldKey, string>>({
    cardpointe: '',
    rentalworks: '',
    ordersCreated: '',
    quotesCreated: '',
  })
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/collections/eod', { cache: 'no-store' })
      if (!r.ok) return
      const j = (await r.json()) as EodData
      setData(j)
      setVals({
        cardpointe: j.figures.cardpointe.amount.toFixed(2),
        rentalworks: j.figures.rentalworks.amount.toFixed(2),
        ordersCreated: j.figures.ordersCreated.amount.toFixed(2),
        quotesCreated: j.figures.quotesCreated.amount.toFixed(2),
      })
    } catch {
      /* the panel is opened on demand; a failed load just shows nothing */
    }
  }, [])

  useEffect(() => {
    if (open && !data) void load()
  }, [open, data, load])

  const send = async () => {
    if (!data) return
    if (
      data.alreadySentAt &&
      !window.confirm(
        `Tonight's report already went out at ${timeAgoLabel(data.alreadySentAt)}. Send it again with these figures?`,
      )
    ) {
      return
    }
    setSending(true)
    setMsg(null)
    try {
      const r = await fetch('/api/collections/eod/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: data.figures.date, ...vals, note }),
      })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; to?: string[] }
      if (!r.ok || j.error) {
        setMsg({ kind: 'err', text: j.error || 'That did not send.' })
      } else {
        setMsg({ kind: 'ok', text: `Sent to ${(j.to ?? []).join(', ')}.` })
        void load()
      }
    } catch {
      setMsg({ kind: 'err', text: 'That did not send.' })
    } finally {
      setSending(false)
    }
  }

  const ctx = data?.figures.context
  const collectedTotal = Number(vals.rentalworks) || 0
  const cardPortion = Number(vals.cardpointe) || 0
  const nonCard = Math.round((collectedTotal - cardPortion) * 100) / 100
  // Card is part of the total, so this ordering cannot happen. Almost always a
  // digit typed into the wrong box, and it would go out looking plausible.
  const cardExceedsTotal = cardPortion > collectedTotal + 0.005

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setOpen((v) => !v)}
          className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-[12px] font-semibold"
        >
          {open ? 'Close EOD report' : 'Send EOD Report'}
        </button>
        {data?.alreadySentAt && (
          <span className="text-[12px] text-emerald-700">
            Sent {timeAgoLabel(data.alreadySentAt)}
            {data.alreadySentBy ? ` by ${data.alreadySentBy}` : ''}
          </span>
        )}
        {!open && msg && (
          <span className={`text-[12px] ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>
            {msg.text}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-4">
          {!data ? (
            <p className="text-[12px] text-zinc-500">Adding up today…</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <h3 className="text-[13px] font-semibold text-zinc-900">
                  End of day ·{' '}
                  {new Date(`${data.figures.date}T12:00:00Z`).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}
                </h3>
                <span className="text-[12px] text-zinc-500">
                  Goes to {data.recipients.length ? data.recipients.join(', ') : 'nobody yet — set recipients in admin'}
                </span>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {FIELDS.map((f) => {
                  const fig = data.figures[f.key]
                  return (
                    <label key={f.key} className="block">
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-700">
                        {f.label}
                        {fig.partial && (
                          <span
                            className="text-[10px] font-bold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-200 rounded px-1"
                            title="HQ cannot see the whole picture for this one — check it before sending."
                          >
                            check
                          </span>
                        )}
                      </span>
                      <span className="mt-1 flex items-center rounded-lg border border-zinc-300 bg-white pl-2.5 focus-within:border-zinc-900">
                        <span className="text-[12px] text-zinc-400">$</span>
                        <input
                          value={vals[f.key]}
                          onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
                          inputMode="decimal"
                          className="w-full bg-transparent px-1.5 py-1.5 text-[13px] tabular-nums text-zinc-900 outline-none"
                        />
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug text-zinc-500">{fig.source}</span>
                    </label>
                  )
                })}
              </div>

              {cardExceedsTotal && (
                <p className="mt-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-[12px] text-rose-700">
                  The card figure is larger than the total collected. Card payments are part of that
                  total, so one of the two is off.
                </p>
              )}

              {!cardExceedsTotal && Math.abs(nonCard) >= 0.01 && (
                <p className="mt-2 text-[12px] text-zinc-600">
                  That leaves <span className="font-semibold tabular-nums text-zinc-900">{usd(nonCard)}</span>{' '}
                  in ACH, wire or cheques — the email works this out and shows it.
                </p>
              )}

              {ctx && ctx.rwObservedCount > 0 && (
                <p className="mt-2 text-[11.5px] text-zinc-500">
                  Cross-check: RentalWorks shows {ctx.rwObservedCount} invoice
                  {ctx.rwObservedCount === 1 ? '' : 's'} flipped to paid today, totalling{' '}
                  <span className="tabular-nums">{usd(ctx.rwObservedPaid)}</span>. Whole invoice
                  amounts, so a part-payment reads high.
                </p>
              )}

              {ctx && (
                <div className="mt-3 rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2 text-[11.5px] text-zinc-600 leading-relaxed">
                  Also going in the email:{' '}
                  <span className="text-zinc-900 font-semibold tabular-nums">{usd(ctx.outstandingTotal)}</span> open AR
                  across {ctx.outstandingCount} invoice{ctx.outstandingCount === 1 ? '' : 's'}
                  {ctx.achPendingCount > 0 && (
                    <>
                      , and{' '}
                      <span className="text-zinc-900 font-semibold tabular-nums">{usd(ctx.achPending)}</span> of ACH not
                      yet cleared
                    </>
                  )}
                  .
                </div>
              )}

              <label className="mt-3 block">
                <span className="text-[11px] font-semibold text-zinc-700">Your note</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="What the numbers don't say — returns that slipped to Monday, ACH still in flight, anything Dani and Wes should read first."
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-[12.5px] text-zinc-900 outline-none focus:border-zinc-900"
                />
              </label>

              {msg && (
                <p className={`mt-2 text-[12px] ${msg.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {msg.text}
                </p>
              )}

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => void send()}
                  disabled={sending || data.recipients.length === 0 || cardExceedsTotal}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[12px] font-semibold"
                >
                  {sending ? 'Sending…' : data.alreadySentAt ? 'Send again' : 'Send report'}
                </button>
                <button
                  onClick={() => void load()}
                  disabled={sending}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
                >
                  Recalculate
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
