'use client'

import { useEffect, useState } from 'react'
import { SigCanvas } from '@/components/portal/SigCanvas'
import { formatPhone } from '@/lib/format/phone'
import type { PaymentPreference } from '@/lib/payments/paymentPreference'
import { PORTAL } from '@/lib/brand/portalTokens'
import { CC_GUARANTEE_TEXT, CC_ACK_TEXT, CC_SURCHARGE_TEXT } from './terms'
import { CardShell, ContextChip, DoneNote, LockedNote } from './CardShell'
import type { V2Booking, V2Intake } from './types'

/**
 * Credit-card authorization card. Wraps the EXISTING CardPointe/CardSecure
 * tokenization plumbing untouched:
 *   - iframe URL from GET /api/cardpointe/config
 *   - PAN tokenized inside the CardSecure iframe; token arrives via
 *     window postMessage ({"message":{"token":...}})
 *   - saved via POST /api/portal/[token]/sign { step: 'cc', ccToken, ... }
 * Every identity/billing field below is pre-filled from the collect-once
 * intake; the client only enters the card number itself.
 */

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return { first: '', last: '' }
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

export function CcAuthCard({
  token,
  intake,
  booking,
  done,
  locked,
  open,
  onToggle,
  onAuthorized,
}: {
  token: string
  intake: V2Intake
  booking: V2Booking
  done: boolean
  locked: boolean
  open: boolean
  onToggle: () => void
  onAuthorized: () => void
}) {
  const [cardholderFirst, setCardholderFirst] = useState('')
  const [cardholderLast, setCardholderLast] = useState('')
  const [cardType, setCardType] = useState('')
  const [paymentPreference, setPaymentPreference] = useState<PaymentPreference>('CARD')
  const [chargeSummary, setChargeSummary] = useState('')
  const [chargeEstimate, setChargeEstimate] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [sig, setSig] = useState<string | null>(null)
  const [iframeUrl, setIframeUrl] = useState('')
  // null = still asking. Card capture is HIDDEN until the gateway is in
  // production: on UAT the tokenizer works and the gateway approves, so the
  // step looks successful while producing a token that cannot be charged and
  // sending a real client's card to a test environment.
  const [cardLive, setCardLive] = useState<boolean | null>(null)
  const [cpToken, setCpToken] = useState('')
  // Expiry is collected HERE, not in the iframe: the tokenizer does not
  // reliably return it, and the gateway requires it to validate the card.
  const [expMonth, setExpMonth] = useState('')
  const [expYear, setExpYear] = useState('')
  // Billing ZIP is collected HERE rather than read from the saved billing
  // address. It used to come from intake.billingZip, which is blank whenever
  // the client never filled in "Your details" — and nothing required it, so
  // the $0 authorization went to the gateway with no postal at all.
  //
  // The gateway needs it on every card-not-present auth: it is the AVS check
  // that a stored card leans on now that the card-on-file tokenizer no longer
  // captures a CVV, and with surcharging enabled the gateway also uses the
  // cardholder's region to decide whether a fee is permitted at all.
  //
  // Seeded from the saved address when there is one, so the common case is
  // still a pre-filled field the client just confirms.
  const [billingZip, setBillingZip] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [seeded, setSeeded] = useState(false)

  // Seed cardholder name + deposit estimate from the collect-once intake the
  // first time real data is available. Fields stay editable — the cardholder
  // isn't always the contact who filled in the details.
  useEffect(() => {
    if (seeded || !intake.fullName) return
    const { first, last } = splitName(intake.fullName)
    setCardholderFirst((v) => v || first)
    setCardholderLast((v) => v || last)
    setBillingZip((v) => v || (intake.billingZip ?? ''))
    setSeeded(true)
  }, [intake, seeded])

  useEffect(() => {
    if (booking.depositAmount) setChargeEstimate((v) => v || String(booking.depositAmount))
  }, [booking.depositAmount])

  // Lazy-load the CardSecure iframe when the card is first opened —
  // same endpoint the live portal uses.
  useEffect(() => {
    if (!open || iframeUrl || done || locked) return
    // card-on-file: this token is STORED and charged later, merchant-initiated.
    // The CVV-free tokenizer keeps a CVV from riding along on those charges —
    // see /api/cardpointe/config.
    fetch('/api/cardpointe/config?mode=card-on-file')
      .then((r) => r.json())
      .then((d) => {
        setCardLive(d.live === true)
        if (d.live === true && d.iframeUrl) setIframeUrl(d.iframeUrl)
      })
      // Unknown means DON'T collect. Failing closed is the safe direction
      // for a card form.
      .catch(() => setCardLive(false))
  }, [open, iframeUrl, done, locked])

  // CardSecure posts the token back via window message — identical
  // capture pattern to the live portal.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (typeof e.data === 'string' && e.data.startsWith('{"message":')) {
        try {
          // CardSecure posts the token in TWO shapes depending on version:
          //   {"message":"<token>"}        message IS the token
          //   {"message":{"token":"…"}}
          // This handler only knew the object form, so on an account serving
          // the string form no token ever landed and Authorize stayed dead
          // with the card visibly filled in. Same defect fixed in the
          // collections and portal pay surfaces.
          const raw = JSON.parse(e.data)
          const inner = raw?.message
          const tok =
            typeof inner === 'string'
              ? inner
              : typeof inner?.token === 'string'
                ? inner.token
                : ''
          if (tok) setCpToken(tok)
        } catch {}
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const status = done ? 'done' : locked ? 'locked' : 'todo'
  const { first: repFirst, last: repLast } = splitName(intake.fullName)

  return (
    <CardShell
      icon="💳"
      title="Card Authorization"
      subtitle="Card kept on file for deposits & charges"
      status={status}
      statusLabel={done ? 'Authorized' : undefined}
      chips={<ContextChip>🔒 CardPointe secure</ContextChip>}
      open={open}
      onToggle={onToggle}
      actionLabel="Authorize"
    >
      {locked && !done ? (
        <LockedNote title="Credit Card Authorization" />
      ) : done ? (
        <DoneNote title="Credit Card Authorized" sub="Authorization on file with SirReel" />
      ) : cardLive === false ? (
        // Card capture is not live. Rather than a dead step, point the client
        // at the form that genuinely holds their details today. Says nothing
        // about environments — that is our problem, not theirs.
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            We&rsquo;re finishing our new card system. For now, please authorize
            your card on our secure form — it takes a minute and covers this job.
          </p>
          <a
            href="/creditcardauthorization"
            target="_blank"
            rel="noreferrer"
            className="inline-block px-4 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold"
          >
            Authorize your card →
          </a>
          <p className="text-[11px] text-gray-400">
            Prefer to pay by check or bank transfer? Tell your SirReel rep and we
            will send details — no card needed.
          </p>
        </div>
      ) : cardLive === null ? (
        <div className="text-xs text-gray-400">Loading secure card entry…</div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">From your details</div>
            <div>
              <span className="font-semibold">{intake.fullName || '—'}</span>
              {intake.company ? ` · ${intake.company}` : ''}
            </div>
            <div>
              {intake.email || '—'}
              {intake.phone ? ` · ${intake.phone}` : ''}
            </div>
            <div>
              {[intake.billingAddress1, intake.billingAddress2, intake.billingCity, intake.billingState, intake.billingZip]
                .filter(Boolean)
                .join(', ') || 'No billing address saved — add it in Your details above.'}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">How will you pay your invoices?</div>
            <div className="space-y-2">
              {([
                { key: 'CARD', title: 'Charge my card on file', sub: 'A processing fee of up to 3% applies to card payments, where permitted.' },
                { key: 'CHECK_WIRE', title: "I'll pay by check or bank transfer", sub: 'No processing fee. Your card stays on file as security only.' },
                // A real answer, not a missing one. Without it the
                // pre-selected CARD option recorded an undecided client as
                // having agreed to the processing fee.
                { key: 'UNDECIDED', title: "I'll decide later", sub: 'No problem — just let us know before your first invoice.' },
              ] as const).map((opt) => (
                <label
                  key={opt.key}
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border cursor-pointer ${
                    paymentPreference === opt.key ? 'border-gray-900 bg-gray-50' : 'border-gray-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="v2-payPref"
                    checked={paymentPreference === opt.key}
                    onChange={() => setPaymentPreference(opt.key)}
                    className="mt-0.5 accent-gray-900"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-gray-800">{opt.title}</span>
                    <span className="block text-[11px] text-gray-500">{opt.sub}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-gray-500">
              Either way, your card is authorized and kept on file as a guarantee for deposits, unpaid balances, and damages.
            </div>
          </div>

          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Cardholder *</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-400 mb-1 block">First Name *</label>
                <input
                  value={cardholderFirst}
                  onChange={(e) => setCardholderFirst(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 mb-1 block">Last Name *</label>
                <input
                  value={cardholderLast}
                  onChange={(e) => setCardholderLast(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Card Type</div>
            <div className="flex gap-2">
              {['AMEX', 'VISA', 'MASTERCARD'].map((type) => (
                <label
                  key={type}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer ${
                    cardType === type ? 'border-gray-900 bg-gray-50 font-semibold' : 'border-gray-200'
                  }`}
                >
                  <input type="radio" name="v2-cardType" checked={cardType === type} onChange={() => setCardType(type)} className="accent-gray-900" />
                  <span className="text-sm">{type === 'MASTERCARD' ? 'MC' : type}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Summary of Charges</div>
            <textarea
              value={chargeSummary}
              onChange={(e) => setChargeSummary(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400 resize-none"
              rows={2}
              placeholder="e.g. Truck Rentals, Production Supplies…"
            />
            <input
              type="number"
              value={chargeEstimate}
              onChange={(e) => setChargeEstimate(e.target.value)}
              className="mt-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
              placeholder="Approximate estimate ($)"
            />
          </div>

          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Card Number *</div>
            {/* No fixed wrapper height. This was 48px with overflow-hidden —
                sized for the old number-only widget — so once usecvv was
                enabled the CVV field rendered inside the 150px iframe but sat
                entirely below the visible 48px, with scrolling='no' hiding it.
                The tokenizer will not emit a token until CVV is filled, so a
                client could type a full card number and never get one: the
                exact dead-Authorize-button symptom. Same clipping already
                fixed in collections and the portal pay panel. */}
            <div className={`border rounded-xl overflow-hidden transition-all ${cpToken ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200'}`}>
              {iframeUrl ? (
                <iframe src={iframeUrl} frameBorder="0" scrolling="no" width="100%" height="150" title="Card Entry" className="block bg-white" />
              ) : (
                <div className="flex items-center justify-center py-6 text-xs text-gray-400">Loading secure card entry…</div>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <select
                value={expMonth}
                onChange={(e) => setExpMonth(e.target.value)}
                aria-label="Expiry month"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900"
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
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900"
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
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900"
              />
            </div>
            {cpToken ? (
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-600 font-semibold">
                <span>✓</span>
                <span>Card captured securely</span>
              </div>
            ) : (
              iframeUrl && <div className="mt-1 text-[10px] text-gray-400">Enter your card number above — it is encrypted and never stored by SirReel.</div>
            )}
          </div>

          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <span className="font-bold">Credit Card Processing Fee.</span> {CC_SURCHARGE_TEXT}
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600">{CC_GUARANTEE_TEXT}</div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 w-4 h-4 accent-gray-900" />
            <span className="text-sm text-gray-700 font-medium">{CC_ACK_TEXT}</span>
          </label>

          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Cardholder Signature</div>
            <SigCanvas onChange={setSig} />
          </div>

          {error && <div className="text-[11px] text-red-600">{error}</div>}
          <button
            onClick={async () => {
              setError('')
              setSubmitting(true)
              try {
                const r = await fetch(`/api/portal/${token}/sign`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    step: 'cc',
                    ccRepFirst: repFirst,
                    ccRepLast: repLast,
                    ccRepPhone: intake.phone,
                    ccRepEmail: intake.email,
                    ccCardholderFirst: cardholderFirst,
                    ccCardholderLast: cardholderLast,
                    ccAddress1: intake.billingAddress1,
                    ccAddress2: intake.billingAddress2,
                    ccCity: intake.billingCity,
                    ccState: intake.billingState,
                    ccZip: billingZip,
                    ccBillingPhone: formatPhone(intake.phone),
                    ccBillingEmail: intake.email,
                    ccCardType: cardType,
                    ccPaymentPreference: paymentPreference,
                    ccChargeSummary: chargeSummary,
                    ccChargeEstimate: chargeEstimate,
                    ccToken: cpToken,
                    // Enables the $0 validation + stored-credential
                    // establishment server-side.
                    ccExpiry: `${expMonth}${expYear}`,
                    ccSignatureData: sig || '',
                  }),
                })
                if (!r.ok) {
                  setError('Failed to submit authorization — please try again.')
                  return
                }
                onAuthorized()
              } catch (err: any) {
                setError(err?.message || 'Failed to submit')
              } finally {
                setSubmitting(false)
              }
            }}
            disabled={
              !cardholderFirst ||
              !cardholderLast ||
              !acknowledged ||
              !sig ||
              !cpToken ||
              expMonth.length !== 2 ||
              expYear.length !== 2 ||
              // 5-digit ZIP or ZIP+4. Guarded here as well as seeded above:
              // an unsent postal is invisible at the time it happens and only
              // surfaces later, as a decline or a compliance finding.
              !/^\d{5}(-\d{4})?$/.test(billingZip) ||
              submitting
            }
            className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: PORTAL.ink }}
          >
            {submitting ? 'Submitting…' : 'Authorize & Complete ✓'}
          </button>
          {/* A disabled button with every visible field filled reads as a broken
              page — the card number lives in a CardSecure iframe, so its
              encryption can still be pending when everything else looks done.
              Say which one is missing rather than making the client guess. */}
          {!submitting && !cpToken && cardholderFirst && cardholderLast && acknowledged && sig && (
            <p className="mt-2 text-[11px] text-center text-gray-400">
              Waiting on the card — enter the card number and CVV above, then
              click outside the field to finish encrypting it.
            </p>
          )}
          {/* Same reasoning for the ZIP: it is the one required field that can
              arrive pre-filled, so a client who never saw it type anything is
              the likeliest person to be staring at a dead button. */}
          {!submitting && cpToken && !/^\d{5}(-\d{4})?$/.test(billingZip) && (
            <p className="mt-2 text-[11px] text-center text-gray-400">
              Add the billing ZIP for this card — your bank checks it against
              the cardholder&rsquo;s address.
            </p>
          )}
        </div>
      )}
    </CardShell>
  )
}
