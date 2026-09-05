'use client'

/**
 * /invoice/[token] — "is this good to charge?", answered with one click.
 *
 * Reached from the two buttons in the final-invoice email. The email
 * pre-selects the answer (?answer=card|bank) and this page asks for one
 * confirming click, so a link scanner in the client's mail system cannot
 * answer for them. Written for a production accountant who has never seen
 * SirReel's systems: the show, the number, the two ways to pay, confirm.
 *
 * Shows no bank details — those stay behind the pay-details share link,
 * which the BANK confirmation hands over — and no card number beyond the
 * last four the email already named.
 */

import { useEffect, useState } from 'react'
import { Check, CreditCard, Landmark } from 'lucide-react'

type Answer = 'CARD' | 'BANK'

interface Loaded {
  settled: boolean
  jobName: string
  invoiceNumber: string | null
  amount: number
  card: { last4: string | null; cardType: string | null } | null
  bankDueBy: string | null
  answered: { answer: string; at: string | null; note: string | null; cardLast4: string | null } | null
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function cardLabel(card: { last4: string | null; cardType: string | null }): string {
  const type = card.cardType?.trim()
  return `${type ? `${type} ` : ''}card ending ····${card.last4 ?? '????'}`
}

export default function InvoiceReplyPage({ params }: { params: { token: string } }) {
  const [data, setData] = useState<Loaded | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'gone'>('loading')
  const [choice, setChoice] = useState<Answer | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{
    answer: Answer
    cardLast4: string | null
    payDetailsLink: string | null
    bankDueBy: string | null
  } | null>(null)

  useEffect(() => {
    // Read off the URL directly rather than useSearchParams, which wants a
    // Suspense boundary and buys nothing on a page this small.
    const preselect = new URLSearchParams(window.location.search).get('answer')?.toLowerCase()
    fetch(`/api/public/invoice-reply/${encodeURIComponent(params.token)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) {
          setData(d)
          setState('ready')
          // Pre-select what the email button said; a card answer with no
          // card on file falls through to bank.
          if (preselect === 'card' && d.card) setChoice('CARD')
          else if (preselect === 'bank' || (preselect === 'card' && !d.card)) setChoice('BANK')
        } else setState('gone')
      })
      .catch(() => setState('gone'))
  }, [params.token])

  const submit = async () => {
    if (!choice || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/public/invoice-reply/${encodeURIComponent(params.token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: choice, note: note.trim() || undefined }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d.ok) {
        setDone({
          answer: d.answer,
          cardLast4: d.cardLast4 ?? null,
          payDetailsLink: d.payDetailsLink ?? null,
          bankDueBy: d.bankDueBy ?? null,
        })
      } else if (d.reason === 'settled') {
        setData((cur) => (cur ? { ...cur, settled: true } : cur))
      } else if (d.reason === 'no_card') {
        setChoice('BANK')
        setError('That card is no longer on file. You can pay by bank transfer or check instead.')
      } else {
        setError('Something went wrong recording your answer. Please reply to the invoice email instead.')
      }
    } catch {
      setError('Something went wrong recording your answer. Please reply to the invoice email instead.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-6">
          <div className="text-[11px] uppercase tracking-[0.2em] text-amber-600 font-semibold">
            SirReel Studio Services
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mt-1">Final invoice</h1>
        </div>

        {state === 'loading' && <p className="text-center text-sm text-gray-400">Loading…</p>}

        {state === 'gone' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-700">This link is no longer available.</p>
            <p className="text-sm text-gray-500 mt-3">
              Reply to the invoice email, or write to{' '}
              <a href="mailto:billing@sirreel.com" className="underline">
                billing@sirreel.com
              </a>
              .
            </p>
          </div>
        )}

        {state === 'ready' && data && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 pt-6 pb-5 border-b border-gray-100">
              <div className="text-[11px] uppercase tracking-wider text-gray-400">Project</div>
              <div className="text-lg font-semibold text-gray-900">{data.jobName}</div>
              <div className="flex items-baseline justify-between mt-3">
                <span className="text-[11px] uppercase tracking-wider text-gray-400">
                  {data.invoiceNumber ? `Invoice ${data.invoiceNumber}` : 'Amount due'}
                </span>
                <span className="text-2xl font-bold text-gray-900 tabular-nums">{money(data.amount)}</span>
              </div>
            </div>

            {data.settled ? (
              <div className="px-6 py-8 text-center">
                <div className="mx-auto w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Check size={20} aria-hidden />
                </div>
                <p className="mt-3 text-sm text-gray-700">This invoice has been settled. Thank you!</p>
              </div>
            ) : done ? (
              <div className="px-6 py-8">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 shrink-0 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <Check size={18} aria-hidden />
                  </div>
                  <div>
                    {done.answer === 'CARD' ? (
                      <>
                        <p className="text-[15px] font-semibold text-gray-900">
                          Thank you — we&rsquo;ll charge the card ending ····{done.cardLast4 ?? '????'}.
                        </p>
                        <p className="mt-1.5 text-sm text-gray-600">
                          {money(data.amount)} plus the card processing fee (up to 3%, where permitted).
                          You&rsquo;ll receive a receipt once it runs.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-[15px] font-semibold text-gray-900">
                          Thank you — we&rsquo;ll look out for your payment.
                        </p>
                        <p className="mt-1.5 text-sm text-gray-600">
                          {money(data.amount)} by ACH, wire or check, no fee
                          {done.bankDueBy ? ` — by ${done.bankDueBy}` : ''} so we can close out the project.
                        </p>
                        {done.payDetailsLink && (
                          <a
                            href={done.payDetailsLink}
                            className="mt-4 inline-block bg-gray-900 text-white text-sm font-semibold px-4 py-2.5 rounded-lg"
                          >
                            View payment details →
                          </a>
                        )}
                        <p className="mt-3 text-xs text-gray-500">
                          Our payment details never change. If you ever receive a notice that they have,
                          call (888) 477-7335 before sending funds.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-6 py-6">
                {data.answered && (
                  <p className="mb-4 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-2.5">
                    You told us{' '}
                    {data.answered.at
                      ? `on ${new Date(data.answered.at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} `
                      : ''}
                    {data.answered.answer === 'CARD'
                      ? `to charge the card ending ····${data.answered.cardLast4 ?? '????'}`
                      : 'you would pay by bank transfer or check'}
                    . You can change that here.
                  </p>
                )}

                <p className="text-sm text-gray-700 mb-4">How would you like to pay?</p>

                <div className="space-y-3">
                  {data.card && (
                    <button
                      type="button"
                      onClick={() => setChoice('CARD')}
                      className={`w-full text-left rounded-xl border p-4 flex items-start gap-3 transition-colors ${
                        choice === 'CARD'
                          ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900'
                          : 'border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      <CreditCard size={20} className="mt-0.5 shrink-0 text-gray-700" aria-hidden />
                      <span>
                        <span className="block text-[15px] font-semibold text-gray-900">
                          Charge the {cardLabel(data.card)}
                        </span>
                        <span className="block text-sm text-gray-600 mt-0.5">
                          A 3% processing fee applies. We run it and send a receipt.
                        </span>
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setChoice('BANK')}
                    className={`w-full text-left rounded-xl border p-4 flex items-start gap-3 transition-colors ${
                      choice === 'BANK'
                        ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900'
                        : 'border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    <Landmark size={20} className="mt-0.5 shrink-0 text-gray-700" aria-hidden />
                    <span>
                      <span className="block text-[15px] font-semibold text-gray-900">
                        Pay by ACH, wire or check
                      </span>
                      <span className="block text-sm text-gray-600 mt-0.5">
                        No fee. Please send within 3 business days
                        {data.bankDueBy ? ` — by ${data.bankDueBy}` : ''} so we can close out the project.
                      </span>
                    </span>
                  </button>
                </div>

                <label className="block mt-4">
                  <span className="text-[11px] uppercase tracking-wider text-gray-400">
                    Anything we should know? (optional)
                  </span>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 500))}
                    rows={2}
                    placeholder="e.g. our AP runs on Fridays, or a PO number to reference"
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  />
                </label>

                {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

                <button
                  type="button"
                  disabled={!choice || busy}
                  onClick={() => void submit()}
                  className="mt-4 w-full bg-gray-900 text-white text-[15px] font-semibold px-4 py-3 rounded-lg disabled:opacity-40"
                >
                  {busy
                    ? 'Sending…'
                    : choice === 'CARD'
                      ? 'Yes, charge the card'
                      : choice === 'BANK'
                        ? 'Confirm — I’ll pay by bank or check'
                        : 'Choose an option'}
                </button>

                <p className="mt-4 text-xs text-gray-500 text-center">
                  Questions? Reply to the invoice email or call (888) 477-7335.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
