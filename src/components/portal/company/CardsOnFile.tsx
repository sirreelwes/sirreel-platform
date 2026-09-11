'use client'

/**
 * "Cards on file" — the production company's account-level card wallet, in
 * its own portal.
 *
 * Wes 2026-09-11: "often the person who sends the credit card isn't the
 * production team client... perhaps an accounting login for production
 * companies?" This is that seat's surface: put a card down ONCE and it
 * covers every show on the account (the job portal's Card Authorization
 * row already reads the wallet — jobCardOnFile.ts), so their teams stop
 * being asked for a card on each job.
 *
 * The capture is the same CardSecure iframe flow as the job paperwork
 * portal (CcAuthCard): PAN tokenized inside CardPointe's iframe, only the
 * token reaches us; expiry + billing ZIP collected here because the
 * tokenizer does not return them and the gateway needs both; guarantee +
 * surcharge text shown, acknowledgment ticked, cardholder signs. The
 * server runs the $0 verification and refuses to store a decline.
 *
 * Hidden entirely while card capture is not live (UAT) — on the sandbox the
 * form would look successful while producing a token that cannot be
 * charged. Never removes a card: that is a rep action (soft-remove, since
 * settled charges reference the row).
 */

import { useEffect, useState } from 'react'
import { Check, CreditCard, Plus, X } from 'lucide-react'
import { SigCanvas } from '@/components/portal/SigCanvas'
import { PORTAL } from '@/lib/brand/portalTokens'
import type { PaymentPreference } from '@/lib/payments/paymentPreference'
import type { ClientCardRow } from '@/lib/portal/companyPortalCards'
import { CC_ACK_TEXT, CC_GUARANTEE_TEXT, CC_SURCHARGE_TEXT } from '@/components/portal-v2/terms'

const ZIP_RE = /^\d{5}(-\d{4})?$/

function fmtExpiry(mmyy: string | null): string {
  if (!mmyy || mmyy.length !== 4) return '—'
  return `${mmyy.slice(0, 2)}/${mmyy.slice(2)}`
}

function brand(cardType: string | null): string {
  if (!cardType) return 'Card'
  const t = cardType.toUpperCase()
  if (t === 'MASTERCARD' || t === 'MC') return 'Mastercard'
  if (t === 'AMEX') return 'Amex'
  if (t === 'VISA') return 'Visa'
  if (t === 'DISCOVER') return 'Discover'
  return cardType
}

export function CardsOnFile({
  companyId,
  companyName,
  viewerName,
  initial,
  preview = false,
}: {
  companyId: string
  companyName: string
  viewerName: string
  initial: ClientCardRow[]
  /** HQ's "see what they see" — everything renders, nothing writes. */
  preview?: boolean
}) {
  const [cards, setCards] = useState<ClientCardRow[]>(initial)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingDefault, setSettingDefault] = useState<string | null>(null)

  // Form state
  const [cardholderName, setCardholderName] = useState('')
  const [paymentPreference, setPaymentPreference] = useState<PaymentPreference>('CARD')
  const [expMonth, setExpMonth] = useState('')
  const [expYear, setExpYear] = useState('')
  const [billingZip, setBillingZip] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [sig, setSig] = useState<string | null>(null)
  const [makeDefault, setMakeDefault] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // CardSecure
  const [iframeUrl, setIframeUrl] = useState('')
  const [cardLive, setCardLive] = useState<boolean | null>(null)
  const [cpToken, setCpToken] = useState('')
  const [cardError, setCardError] = useState('')

  useEffect(() => {
    if (!adding || iframeUrl || preview) return
    fetch('/api/cardpointe/config?mode=card-on-file')
      .then((r) => r.json())
      .then((d) => {
        setCardLive(d.live === true)
        if (d.live === true && d.iframeUrl) setIframeUrl(d.iframeUrl)
      })
      // Unknown means DON'T collect — failing closed is the safe direction.
      .catch(() => setCardLive(false))
  }, [adding, iframeUrl, preview])

  useEffect(() => {
    if (!adding) return
    const handler = (e: MessageEvent) => {
      if (typeof e.data !== 'string' || !e.data.startsWith('{')) return
      try {
        // Two shapes depending on tokenizer version: {"message":"<token>"}
        // and {"message":{"token":"…"}}; a bad number arrives as
        // {"message":{"validationError":"…"}} — see CcAuthCard for the
        // history of dropping each of these on the floor.
        const raw = JSON.parse(e.data)
        const inner = raw?.message
        const tok = typeof inner === 'string' ? inner : typeof inner?.token === 'string' ? inner.token : ''
        const invalid = typeof inner === 'object' && typeof inner?.validationError === 'string' ? inner.validationError : ''
        if (tok) {
          setCpToken(tok)
          setCardError('')
        } else if (invalid) {
          setCpToken('')
          setCardError('That card number doesn’t look right — check it and re-enter it.')
        }
      } catch {
        /* not ours */
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [adding])

  const resetForm = () => {
    setCardholderName('')
    setPaymentPreference('CARD')
    setExpMonth('')
    setExpYear('')
    setBillingZip('')
    setAcknowledged(false)
    setSig(null)
    setCpToken('')
    setCardError('')
    setMakeDefault(true)
  }

  const canSubmit =
    !preview &&
    !!cpToken &&
    cardholderName.trim().length >= 2 &&
    expMonth.length === 2 &&
    expYear.length === 2 &&
    ZIP_RE.test(billingZip) &&
    acknowledged &&
    !!sig &&
    !submitting

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/portal/company/${companyId}/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardToken: cpToken,
          expiry: `${expMonth}${expYear}`,
          billingPostal: billingZip,
          cardholderName: cardholderName.trim(),
          paymentPreference,
          acknowledged,
          signatureData: sig,
          makeDefault,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || "That didn't go through.")
      setCards(json.cards || cards)
      setNotice(
        [
          `Card ending ${json.cards?.find((c: ClientCardRow) => c.id === json.cardId)?.last4 ?? '····'} is on file for ${companyName}. It covers every show on this account.`,
          json.notice,
        ]
          .filter(Boolean)
          .join(' '),
      )
      resetForm()
      setAdding(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.")
    } finally {
      setSubmitting(false)
    }
  }

  async function setDefault(cardId: string) {
    if (preview) return
    setSettingDefault(cardId)
    setError(null)
    try {
      const res = await fetch(`/api/portal/company/${companyId}/cards`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || "That didn't go through.")
      setCards(json.cards || cards)
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.")
    } finally {
      setSettingDefault(null)
    }
  }

  const inputCls =
    'w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-zinc-500'

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <div className="p-5 border-b border-zinc-100 flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-zinc-600 leading-relaxed max-w-[58ch]">
          A card on file here covers every show under {companyName} — deposits, balances and
          damages under the rental agreement — so your production teams aren&apos;t asked for a
          card on each job. Add one once; to take a card off file, tell your rep.
        </p>
        {!adding && (
          <button
            type="button"
            onClick={() => !preview && setAdding(true)}
            disabled={preview}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: PORTAL.dark }}
            title={preview ? 'Disabled in preview' : undefined}
          >
            <Plus className="w-3.5 h-3.5" /> Add a card
          </button>
        )}
      </div>

      {notice && (
        <div className="px-5 py-3 bg-emerald-50 border-b border-emerald-100 text-xs text-emerald-800 leading-relaxed">
          {notice}
        </div>
      )}
      {error && !adding && (
        <div className="px-5 py-3 bg-red-50 border-b border-red-100 text-xs text-red-700">{error}</div>
      )}

      {/* ── The wallet ─────────────────────────────────────────────────── */}
      {cards.length === 0 ? (
        <div className="px-5 py-6 text-sm text-zinc-500">
          No card on file yet. Until there is one, each show asks for a card authorization on its
          own paperwork.
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {cards.map((c) => (
            <li key={c.id} className="px-5 py-3 flex items-center gap-4 flex-wrap">
              <span className="text-zinc-400"><CreditCard className="w-4 h-4" aria-hidden /></span>
              <div className="min-w-[12rem]">
                <div className="text-sm font-semibold text-zinc-900">
                  {brand(c.cardType)} ending {c.last4 ?? '····'}
                  {c.label ? <span className="font-normal text-zinc-500"> · {c.label}</span> : null}
                </div>
                <div className="text-[11px] text-zinc-500">
                  {c.cardholderName || 'Cardholder not recorded'} · exp {fmtExpiry(c.expiry)}
                  {c.addedBy === 'STAFF' ? ' · keyed by your rep from a signed authorization' : ''}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2 text-[11px]">
                {c.expired && (
                  <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 font-semibold">Expired</span>
                )}
                {!c.validated && !c.expired && (
                  <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold">Bank check pending</span>
                )}
                {c.isDefault ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-900 text-white font-semibold">
                    <Check className="w-3 h-3" aria-hidden /> Charged first
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDefault(c.id)}
                    disabled={preview || settingDefault === c.id}
                    className="underline text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
                    title={preview ? 'Disabled in preview' : undefined}
                  >
                    {settingDefault === c.id ? 'Saving…' : 'Use this card first'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── Add a card ─────────────────────────────────────────────────── */}
      {adding && (
        <div className="p-5 border-t border-zinc-100 bg-zinc-50 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase font-semibold tracking-wider text-zinc-400">
              Authorize a card for {companyName}
            </div>
            <button
              type="button"
              onClick={() => {
                resetForm()
                setAdding(false)
                setError(null)
              }}
              className="text-zinc-400 hover:text-zinc-900"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {cardLive === false ? (
            <div className="text-sm text-zinc-700 space-y-2">
              <p>
                Card entry isn&apos;t available right now. Your rep can take the authorization
                another way — email them from the footer of this page.
              </p>
            </div>
          ) : cardLive === null ? (
            <div className="text-xs text-zinc-400">Loading secure card entry…</div>
          ) : (
            <>
              <div>
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                  How will you pay invoices?
                </div>
                <div className="space-y-2">
                  {(
                    [
                      { key: 'CARD', title: 'Charge this card', sub: 'A processing fee of up to 3% applies to card payments, where permitted.' },
                      { key: 'CHECK_WIRE', title: 'By check or bank transfer', sub: 'No processing fee. The card stays on file as security only.' },
                      { key: 'UNDECIDED', title: 'Decide per invoice', sub: 'Just let us know before each first invoice.' },
                    ] as const
                  ).map((opt) => (
                    <label
                      key={opt.key}
                      className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border cursor-pointer bg-white ${
                        paymentPreference === opt.key ? 'border-zinc-900' : 'border-zinc-200'
                      }`}
                    >
                      <input
                        type="radio"
                        name="company-payPref"
                        checked={paymentPreference === opt.key}
                        onChange={() => setPaymentPreference(opt.key)}
                        className="mt-0.5 accent-zinc-900"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-zinc-800">{opt.title}</span>
                        <span className="block text-[11px] text-zinc-500">{opt.sub}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2 block">
                  Cardholder name *
                </label>
                <input
                  value={cardholderName}
                  onChange={(e) => setCardholderName(e.target.value)}
                  autoComplete="cc-name"
                  placeholder="As it appears on the card"
                  className={inputCls}
                />
              </div>

              <div>
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Card number *</div>
                <div
                  className={`border rounded-xl overflow-hidden transition-all ${
                    cpToken ? 'border-emerald-400 bg-emerald-50' : 'border-zinc-200'
                  }`}
                >
                  {iframeUrl ? (
                    <iframe
                      src={iframeUrl}
                      frameBorder="0"
                      scrolling="no"
                      width="100%"
                      height="150"
                      title="Card Entry"
                      className="block bg-white"
                    />
                  ) : (
                    <div className="flex items-center justify-center py-6 text-xs text-zinc-400">
                      Loading secure card entry…
                    </div>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <select
                    value={expMonth}
                    onChange={(e) => setExpMonth(e.target.value)}
                    aria-label="Expiry month"
                    className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900"
                  >
                    <option value="">Exp. month</option>
                    {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <select
                    value={expYear}
                    onChange={(e) => setExpYear(e.target.value)}
                    aria-label="Expiry year"
                    className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900"
                  >
                    <option value="">Exp. year</option>
                    {Array.from({ length: 15 }, (_, i) => 26 + i).map((y) => (
                      <option key={y} value={String(y)}>20{y}</option>
                    ))}
                  </select>
                  <input
                    value={billingZip}
                    onChange={(e) => setBillingZip(e.target.value.replace(/[^0-9-]/g, '').slice(0, 10))}
                    inputMode="numeric"
                    autoComplete="billing postal-code"
                    aria-label="Billing ZIP code"
                    placeholder="Billing ZIP"
                    className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900"
                  />
                </div>
                {cpToken ? (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-700 font-semibold">
                    <Check className="w-3.5 h-3.5" aria-hidden /> Card captured securely
                  </div>
                ) : cardError ? (
                  <div className="mt-1.5 text-[11px] text-red-600 font-semibold">{cardError}</div>
                ) : (
                  iframeUrl && (
                    <div className="mt-1 text-[10px] text-zinc-400">
                      Enter the card number above, then tap outside the box — it is encrypted there
                      and never reaches SirReel. Expiry and ZIP go in the fields below; we don&apos;t
                      ask for the CVV on a card kept on file.
                    </div>
                  )
                )}
              </div>

              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <span className="font-bold">Credit Card Processing Fee.</span> {CC_SURCHARGE_TEXT}
              </div>
              <div className="bg-white border border-zinc-100 rounded-xl p-3 text-xs text-zinc-600">{CC_GUARANTEE_TEXT}</div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-zinc-900"
                />
                <span className="text-sm text-zinc-700 font-medium">{CC_ACK_TEXT}</span>
              </label>

              <div>
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">
                  Cardholder signature
                </div>
                <SigCanvas onChange={setSig} />
                <div className="mt-1 text-[10px] text-zinc-400">Signing as {viewerName}.</div>
              </div>

              {cards.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-zinc-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={makeDefault}
                    onChange={(e) => setMakeDefault(e.target.checked)}
                    className="w-4 h-4 accent-zinc-900"
                  />
                  Charge this card first from now on
                </label>
              )}

              {error && <div className="text-[11px] text-red-600">{error}</div>}
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                style={{ backgroundColor: PORTAL.ink }}
              >
                {submitting ? 'Verifying with your bank…' : 'Authorize & keep on file'}
              </button>
              {!submitting && !cpToken && cardholderName && acknowledged && sig && (
                <p className="text-[11px] text-center text-zinc-400">
                  Waiting on the card — enter the number above, then tap outside the field to finish
                  encrypting it.
                </p>
              )}
              {!submitting && cpToken && !ZIP_RE.test(billingZip) && (
                <p className="text-[11px] text-center text-zinc-400">
                  Add the billing ZIP for this card — your bank checks it against the cardholder&apos;s
                  address.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
