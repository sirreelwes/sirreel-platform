'use client'

import { useEffect, useState } from 'react'
import { SigCanvas } from '@/components/portal/SigCanvas'
import { formatPhone } from '@/lib/format/phone'
import { TSX } from '@/lib/brand/tsxTokens'
import { CC_GUARANTEE_TEXT, CC_ACK_TEXT } from './terms'
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
  const [chargeSummary, setChargeSummary] = useState('')
  const [chargeEstimate, setChargeEstimate] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [sig, setSig] = useState<string | null>(null)
  const [iframeUrl, setIframeUrl] = useState('')
  const [cpToken, setCpToken] = useState('')
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
    setSeeded(true)
  }, [intake, seeded])

  useEffect(() => {
    if (booking.depositAmount) setChargeEstimate((v) => v || String(booking.depositAmount))
  }, [booking.depositAmount])

  // Lazy-load the CardSecure iframe when the card is first opened —
  // same endpoint the live portal uses.
  useEffect(() => {
    if (!open || iframeUrl || done || locked) return
    fetch('/api/cardpointe/config')
      .then((r) => r.json())
      .then((d) => {
        if (d.iframeUrl) setIframeUrl(d.iframeUrl)
      })
      .catch(() => {})
  }, [open, iframeUrl, done, locked])

  // CardSecure posts the token back via window message — identical
  // capture pattern to the live portal.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (typeof e.data === 'string' && e.data.startsWith('{"message":')) {
        try {
          const msg = JSON.parse(e.data)
          if (msg.message?.token) setCpToken(msg.message.token)
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
            <div className={`border rounded-xl overflow-hidden transition-all ${cpToken ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200'}`} style={{ height: 48 }}>
              {iframeUrl ? (
                <iframe src={iframeUrl} frameBorder="0" scrolling="no" width="100%" height="48" title="Card Entry" />
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-gray-400">Loading secure card entry…</div>
              )}
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
                    ccZip: intake.billingZip,
                    ccBillingPhone: formatPhone(intake.phone),
                    ccBillingEmail: intake.email,
                    ccCardType: cardType,
                    ccChargeSummary: chargeSummary,
                    ccChargeEstimate: chargeEstimate,
                    ccToken: cpToken,
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
            disabled={!cardholderFirst || !cardholderLast || !acknowledged || !sig || !cpToken || submitting}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: TSX.ink }}
          >
            {submitting ? 'Submitting…' : 'Authorize & Complete ✓'}
          </button>
        </div>
      )}
    </CardShell>
  )
}
