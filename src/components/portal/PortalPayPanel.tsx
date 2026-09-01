'use client'

/**
 * PortalPayPanel — client-portal invoice pay surface.
 *
 * Phase 6 commit 2 — card path live. ACH path stub gated behind
 * NEXT_PUBLIC_ACH_ENABLED, default off.
 *
 * LEAVE IT OFF. This is not an unfinished feature waiting on Commit 3 —
 * SirReel evaluated Fiserv's pull-ACH product on 2026-08-10 and declined it
 * on price (1% uncapped + $0.50/txn, against invoices of $1k–$25k). Clients
 * push bank transfers from their own banks instead, which costs neither side
 * anything, and the card on file already provides charge-when-we-want with
 * the client absorbing the surcharge.
 *
 * Enabling this flag would also offer a payment method the merchant account
 * is not provisioned for. Revisit only if Fiserv offers a CAPPED discount
 * rate. Clients get bank details from the portal's "Pay by bank transfer"
 * panel (PortalBankDetails).
 *
 * Mounted on the Job Page portal (src/app/portal/job/[slug]/page.tsx),
 * replacing the "Coming soon" Invoice row when an invoice is payable.
 *
 * Card flow:
 *   1. Mount → fetch /api/portal/job/invoices to learn what's payable.
 *   2. Pick an invoice → expand panel → load CardSecure iframe via
 *      /api/cardpointe/config.
 *   3. Iframe posts a message on tokenization → capture `cpToken`.
 *   4. Submit: POST /api/portal/job/invoice/[id]/pay-card with
 *      { cardToken, cardholderName, amount, last4 }.
 *   5. Server charges via CardPointe → on respcode='00' writes
 *      Payment CLEARED → invoice flips to PAID → order may close.
 *   6. UI re-fetches invoices + shows the receipt confirmation.
 *
 * The iframe loads from the same /api/cardpointe/config endpoint
 * already in production for the legacy paperwork portal — no client-
 * side env exposure.
 */

import { useEffect, useState } from 'react'
import { SigCanvas } from './SigCanvas'
import { surchargeBreakdown } from '@/lib/payments/surcharge'

interface PortalInvoice {
  id: string
  invoiceNumber: string
  type: 'RENTAL' | 'LD'
  status: 'DRAFT' | 'SENT' | 'PARTIAL' | 'PAID'
  total: string
  amountPaid: string
  balanceDue: string
  sentAt: string | null
  paidAt: string | null
  createdAt: string
  payable: boolean
  /** The pre-invoice round: a DRAFT sent for review. Never payable —
   *  the client agrees the figure here, and the payable invoice
   *  follows (Wes 2026-09-01). */
  isPreInvoice?: boolean
  preSentAt?: string | null
  approvedAt?: string | null
  changesRequestedAt?: string | null
}

const ACH_ENABLED = process.env.NEXT_PUBLIC_ACH_ENABLED === 'true'

function fmtUsd(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function PortalPayPanel({
  onStatus,
}: {
  /** Lets the wrapping PaperworkRow label itself honestly — a row
   *  headed "Invoice · Issued" beside a pre-invoice is simply wrong
   *  (Wes 2026-09-01). Optional: the panel works standalone. */
  onStatus?: (s: { hasPreInvoice: boolean; awaitingReview: boolean }) => void
} = {}) {
  const [invoices, setInvoices] = useState<PortalInvoice[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const refresh = async () => {
    setErr(null)
    try {
      const r = await fetch('/api/portal/job/invoices', { cache: 'no-store' })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string }
        setErr(j.error || `HTTP ${r.status}`)
        setInvoices([])
        return
      }
      const data = (await r.json()) as { invoices: PortalInvoice[] }
      setInvoices(data.invoices ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load invoices')
      setInvoices([])
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  // Report upward whenever the listing changes.
  //
  // This MUST stay above the early returns below. It once sat under
  // them, which meant the first render (invoices === null) ran three
  // hooks and every later render ran four — React #310, an uncaught
  // client exception that white-screened the ENTIRE portal for any
  // client whose invoices had loaded. It never reproduced locally
  // because a tokenless visit 401s and this panel never mounts.
  // `invoices` is null until the fetch lands; the optional chain keeps
  // that render honest (no pre-invoice yet), which is also the state
  // the parent starts in, so there is no flicker.
  const pre = invoices?.find((i) => i.isPreInvoice) ?? null
  useEffect(() => {
    onStatus?.({ hasPreInvoice: !!pre, awaitingReview: !!pre && !pre.approvedAt })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pre?.id, pre?.approvedAt])

  if (err) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs px-3 py-2">
        Couldn&rsquo;t load invoices: {err}
      </div>
    )
  }
  if (invoices === null) {
    return <div className="text-xs text-gray-500">Loading invoices…</div>
  }
  if (invoices.length === 0) {
    // No invoices yet — Job Page already shows "Issued 24-48 hours
    // after equipment return" elsewhere. Panel renders nothing.
    return null
  }

  return (
    <div className="space-y-3">
      {invoices.map((inv) => (
        <InvoiceRow key={inv.id} invoice={inv} onPaid={refresh} />
      ))}
    </div>
  )
}

// ─── Invoice row ──────────────────────────────────────────────────
function InvoiceRow({
  invoice,
  onPaid,
}: {
  invoice: PortalInvoice
  onPaid: () => void | Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const balance = Number(invoice.balanceDue)
  const total = Number(invoice.total)
  const paid = Number(invoice.amountPaid)

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-3 flex-wrap px-4 py-3 border-b border-gray-100">
        <span className="font-mono text-[11px] text-gray-500">{invoice.invoiceNumber}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
          {invoice.type}
        </span>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
            invoice.isPreInvoice
              ? invoice.approvedAt
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-indigo-100 text-indigo-700'
              : invoice.status === 'PAID'
                ? 'bg-emerald-100 text-emerald-700'
                : invoice.status === 'PARTIAL'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-blue-100 text-blue-700'
          }`}
        >
          {invoice.isPreInvoice
            ? invoice.approvedAt
              ? 'APPROVED'
              : 'PRE-INVOICE'
            : invoice.status}
        </span>
        <span className="text-sm font-semibold text-gray-900 ml-auto">{fmtUsd(total)}</span>
        {paid > 0 && (
          <span className="text-[11px] text-emerald-600">−{fmtUsd(paid)} paid</span>
        )}
        {balance > 0 && !invoice.isPreInvoice && (
          <span className="text-[11px] text-amber-700 font-semibold">
            {fmtUsd(balance)} due
          </span>
        )}
        <a
          href={`/api/portal/job/invoice/${invoice.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] font-semibold text-amber-700 hover:text-amber-900"
        >
          {invoice.isPreInvoice ? 'Review PDF →' : 'PDF →'}
        </a>
        {invoice.payable && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] font-semibold bg-gray-900 hover:bg-gray-800 text-white px-2.5 py-1 rounded"
          >
            {expanded ? 'Close' : 'Pay'}
          </button>
        )}
      </div>
      {invoice.isPreInvoice && (
        <PreInvoiceReview invoice={invoice} onAnswered={onPaid} />
      )}
      {expanded && invoice.payable && (
        <div className="px-4 py-4 bg-gray-50">
          <PayForm invoice={invoice} onPaid={onPaid} />
        </div>
      )}
    </div>
  )
}

// ─── Pre-invoice review ───────────────────────────────────────────
/**
 * The client's side of the pre-invoice round: read the charges, then
 * approve them or say what is wrong. Approving is what wraps the job
 * (Wes 2026-09-01) — it does NOT pay anything, and the copy says so,
 * because "approve" next to a dollar figure reads like a payment
 * authorisation unless it is spelled out.
 */
function PreInvoiceReview({
  invoice,
  onAnswered,
}: {
  invoice: PortalInvoice
  onAnswered: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState<'APPROVE' | 'CHANGES' | null>(null)
  const [showNote, setShowNote] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const answer = async (decision: 'APPROVE' | 'CHANGES') => {
    if (busy) return
    if (decision === 'CHANGES' && !note.trim()) {
      setError('Let us know what needs changing.')
      return
    }
    setBusy(decision)
    setError(null)
    try {
      const res = await fetch(`/api/portal/job/invoice/${invoice.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: note.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'Something went wrong — please try again.')
        return
      }
      await onAnswered()
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setBusy(null)
    }
  }

  if (invoice.approvedAt) {
    return (
      <div className="px-4 py-3 bg-emerald-50 border-t border-emerald-100 text-[13px] text-emerald-800">
        Thanks — you approved these charges on{' '}
        {new Date(invoice.approvedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.
        We&rsquo;ll send the invoice shortly. Nothing further is needed from you right now.
      </div>
    )
  }

  return (
    <div className="px-4 py-4 bg-indigo-50/60 border-t border-indigo-100 space-y-3">
      <p className="text-[13px] text-gray-700">
        <strong>Please review these charges.</strong> This is a pre-invoice, not a bill — nothing is
        due yet. If it all looks right, approve it and we&rsquo;ll issue the invoice.
      </p>
      {invoice.changesRequestedAt && !showNote && (
        <p className="text-[12px] text-amber-800">
          You asked us for changes — we&rsquo;re on it. Approve below once the updated figures look right.
        </p>
      )}
      {error && <p className="text-[12px] text-red-600">{error}</p>}
      {showNote ? (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoFocus
            placeholder="What doesn't look right? (e.g. we returned the generator a day early)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[13px] focus:border-gray-500 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => answer('CHANGES')}
              disabled={busy != null}
              className="rounded-lg bg-gray-900 hover:bg-gray-800 disabled:opacity-50 px-4 py-2 text-[13px] font-semibold text-white"
            >
              {busy === 'CHANGES' ? 'Sending…' : 'Send to SirReel'}
            </button>
            <button
              onClick={() => { setShowNote(false); setError(null) }}
              disabled={busy != null}
              className="px-3 py-2 text-[13px] text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => answer('APPROVE')}
            disabled={busy != null}
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-5 py-2 text-[13px] font-bold text-white"
          >
            {busy === 'APPROVE' ? 'Approving…' : 'Approve these charges'}
          </button>
          <button
            onClick={() => setShowNote(true)}
            disabled={busy != null}
            className="rounded-lg border border-gray-300 bg-white hover:border-gray-500 px-4 py-2 text-[13px] font-semibold text-gray-700"
          >
            Something&rsquo;s not right
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Pay form ─────────────────────────────────────────────────────
type PayMethod = 'card' | 'ach'

function PayForm({
  invoice,
  onPaid,
}: {
  invoice: PortalInvoice
  onPaid: () => void | Promise<void>
}) {
  const [method, setMethod] = useState<PayMethod>('card')

  return (
    <div className="space-y-3">
      {ACH_ENABLED && (
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
          {(['card', 'ach'] as PayMethod[]).map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={`px-3 py-1.5 ${
                method === m
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 hover:text-gray-900'
              }`}
            >
              {m === 'card' ? 'Card' : 'Bank (eCheck)'}
            </button>
          ))}
        </div>
      )}

      {method === 'card' ? (
        <CardPayForm invoice={invoice} onPaid={onPaid} />
      ) : (
        <AchPayForm invoice={invoice} onPaid={onPaid} />
      )}
    </div>
  )
}

// ─── Card pay form ────────────────────────────────────────────────
function CardPayForm({
  invoice,
  onPaid,
}: {
  invoice: PortalInvoice
  onPaid: () => void | Promise<void>
}) {
  const balance = Number(invoice.balanceDue)
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  // Expiry is collected HERE, not in the iframe — the tokenizer does not
  // reliably return it on the postMessage. Not sensitive authentication
  // data, so handling it outside the iframe is safe; PAN and CVV stay in.
  const [expMonth, setExpMonth] = useState('')
  const [expYear, setExpYear] = useState('')
  const [cardToken, setCardToken] = useState<string | null>(null)
  const [last4, setLast4] = useState<string | null>(null)
  const [cardholderName, setCardholderName] = useState('')
  const [amountStr, setAmountStr] = useState(balance.toFixed(2))
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [success, setSuccess] = useState<{
    last4: string | null
    amount: number
    surcharge: number
    total: number
    orderClosed: boolean
  } | null>(null)

  // Load the CardSecure iframe URL.
  useEffect(() => {
    let cancelled = false
    fetch('/api/cardpointe/config')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        // Card PAYMENT is blocked off production entirely. On UAT the gateway
        // approves and we would write a CLEARED Payment for money that never
        // moved — an invoice marked paid with nothing behind it is far worse
        // than a client being told to pay another way.
        if (d.live !== true) {
          setErr(
            'Card payment is temporarily unavailable — please pay by bank transfer, or contact billing@sirreel.com.',
          )
          return
        }
        if (d.iframeUrl) setIframeUrl(d.iframeUrl)
        else setErr(d.error || 'Card entry unavailable')
      })
      .catch(() => {
        if (!cancelled) setErr('Card entry unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // CardSecure postMessage capture. The iframe posts a JSON-string
  // event whose `message.token` carries the card token. It also sends
  // a separate message with `validationError` we surface to the user.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return
      if (!e.data.startsWith('{')) return
      try {
        // CardSecure posts the token in TWO shapes depending on version:
        //   {"message":"<token>"}  ← message IS the token
        //   {"message":{"token":"…"}}
        // Only the object form was handled, so on an account serving the
        // string form no token was ever captured and the pay button could
        // not enable. Accept either.
        const raw = JSON.parse(e.data) as
          | { message?: string | { token?: string; validationError?: string } }
          | null
        const inner = raw?.message
        const tok =
          typeof inner === 'string' ? inner : typeof inner?.token === 'string' ? inner.token : ''
        const vErr =
          typeof inner === 'object' && typeof inner?.validationError === 'string'
            ? inner.validationError
            : ''
        if (tok) {
          setCardToken(tok)
          // Token mirrors the card BIN+last4 pattern; last4 is at the end.
          const tail = tok.slice(-4)
          if (/^\d{4}$/.test(tail)) setLast4(tail)
          setErr(null)
        } else if (vErr) {
          setCardToken(null)
          setLast4(null)
          setErr(vErr)
        }
      } catch {
        /* ignore non-JSON posts from the iframe */
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const amount = Number(amountStr)
  const amountValid = Number.isFinite(amount) && amount > 0 && amount <= balance + 0.001
  // Expiry is required by the gateway, so gate on it too — otherwise the
  // client submits and gets a decline that reads as their card failing.
  const canSubmit =
    !!cardToken &&
    expMonth.length === 2 &&
    expYear.length === 2 &&
    cardholderName.trim().length > 1 &&
    amountValid &&
    !submitting
  // Card is charged base + 3% surcharge; the invoice is credited the base.
  const fee = surchargeBreakdown(amountValid ? amount : 0)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || !cardToken) return
    setSubmitting(true)
    setErr(null)
    try {
      const r = await fetch(`/api/portal/job/invoice/${invoice.id}/pay-card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardToken,
          // Required by the gateway for a card auth; captured from the
          // tokenizer alongside the token.
          expiry: `${expMonth}${expYear}`,
          cardholderName: cardholderName.trim(),
          amount,
          last4,
        }),
      })
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        last4?: string | null
        orderAdvancedToClosed?: boolean
        retref?: string
        base?: number
        surcharge?: number
        totalCharged?: number
      }
      if (!r.ok || !data.ok) {
        setErr(
          data.error
            ? data.retref
              ? `${data.error}`
              : data.error
            : `HTTP ${r.status}`,
        )
        return
      }
      setSuccess({
        last4: data.last4 ?? last4,
        amount: data.base ?? amount,
        surcharge: data.surcharge ?? fee.surcharge,
        total: data.totalCharged ?? fee.total,
        orderClosed: !!data.orderAdvancedToClosed,
      })
      await onPaid()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-4 py-3">
        Payment received: {fmtUsd(success.total)}
        {success.last4 && <> on card ····{success.last4}</>}.
        {success.surcharge > 0 && (
          <span className="block text-xs mt-1">
            {fmtUsd(success.amount)} applied to your balance + {fmtUsd(success.surcharge)} card
            processing fee (3%).
          </span>
        )}
        {success.orderClosed && (
          <span className="block text-xs mt-1">Your order is now closed. Thanks.</span>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="text-[11px] text-gray-500">
        Balance due <span className="font-semibold text-gray-900">{fmtUsd(balance)}</span>. Card
        details are tokenized by CardPointe — SirReel never sees the raw card number.
      </div>

      <label className="block">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
          Cardholder name
        </span>
        <input
          type="text"
          value={cardholderName}
          onChange={(e) => setCardholderName(e.target.value)}
          placeholder="As it appears on the card"
          required
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-900"
        />
      </label>

      <div>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 block mb-1">
          Card number
        </span>
        <div
          className={`border rounded-lg overflow-hidden transition-colors ${
            cardToken ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white'
          }`}
          style={{ height: 48 }}
        >
          {iframeUrl ? (
            <iframe
              src={iframeUrl}
              frameBorder="0"
              scrolling="no"
              width="100%"
              height="150"
              title="Card Entry"
            />
          ) : (
            <div className="px-3 py-2 text-xs text-gray-400">Loading card entry…</div>
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
              <option key={m} value={m}>
                {m}
              </option>
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
              <option key={y} value={String(y)}>
                20{y}
              </option>
            ))}
          </select>
        </div>
        {cardToken && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-600 font-semibold">
            <span>✓</span>
            <span>
              Card captured securely{last4 ? <> · ····{last4}</> : null}
            </span>
          </div>
        )}
        {!cardToken && iframeUrl && (
          <div className="mt-1 text-[10px] text-gray-400">
            Encrypted by CardPointe before it leaves your browser.
          </div>
        )}
      </div>

      <label className="block">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
          Amount
        </span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          max={balance}
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-900"
        />
        {!amountValid && amountStr.length > 0 && (
          <div className="mt-1 text-[11px] text-rose-600">
            Enter an amount up to {fmtUsd(balance)}.
          </div>
        )}
      </label>

      {amountValid && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-0.5">
          <div className="flex justify-between">
            <span>Applied to balance</span>
            <span className="font-medium tabular-nums">{fmtUsd(fee.base)}</span>
          </div>
          <div className="flex justify-between">
            <span>Card processing fee (3%)</span>
            <span className="font-medium tabular-nums">{fmtUsd(fee.surcharge)}</span>
          </div>
          <div className="flex justify-between border-t border-amber-200 pt-0.5 font-bold">
            <span>Total charged to card</span>
            <span className="tabular-nums">{fmtUsd(fee.total)}</span>
          </div>
          <div className="text-[10px] text-amber-700 pt-0.5">To avoid the card fee, pay by check.</div>
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs px-3 py-2">
          {err}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full bg-gray-900 text-white rounded-lg py-3 text-sm font-semibold hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        {submitting ? 'Charging card…' : `Pay ${fmtUsd(amountValid ? fee.total : balance)}`}
      </button>
    </form>
  )
}

// ─── ACH (eCheck) pay form ────────────────────────────────────────
// Bank account tokenization mirrors the card flow — same iframe +
// postMessage tokenizer pattern, but loaded with ?mode=echeck so the
// CardSecure widget accepts a bank account number (no expiry/CVV
// fields). Routing number is captured on our form and posted server-
// side alongside the token.
//
// NACHA authorization is mandatory: a signature + explicit consent
// text are captured on the row at the moment of submit. Without them
// the bank can claw the funds back as unauthorized debits.
//
// PENDING semantics: the success state explicitly says "submitted for
// settlement" rather than "paid" — funds don't actually settle for
// 1-2 business days and the invoice doesn't flip to PAID until the
// Commit 4 polling job advances the row to CLEARED.

function AchPayForm({
  invoice,
  onPaid,
}: {
  invoice: PortalInvoice
  onPaid: () => void | Promise<void>
}) {
  const balance = Number(invoice.balanceDue)
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [bankToken, setBankToken] = useState<string | null>(null)
  const [last4, setLast4] = useState<string | null>(null)
  const [routingNumber, setRoutingNumber] = useState('')
  const [accountType, setAccountType] = useState<'C' | 'S'>('C')
  const [accountHolderName, setAccountHolderName] = useState('')
  const [amountStr, setAmountStr] = useState(balance.toFixed(2))
  const [nachaSignature, setNachaSignature] = useState<string | null>(null)
  const [consentChecked, setConsentChecked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [success, setSuccess] = useState<{
    last4: string | null
    amount: number
  } | null>(null)

  // Build the NACHA consent text from the invoice context. Stored
  // verbatim on the Payment row so an auditor can see exactly what
  // the payer agreed to at submit-time.
  const consentText = `I authorize SirReel Studio Services to electronically debit my bank account in the amount of $${Number(amountStr || balance).toFixed(2)} for invoice ${invoice.invoiceNumber}. I agree this authorization is to remain in full force and effect until SirReel has received written notification of its termination in such time and manner as to afford SirReel a reasonable opportunity to act on it.`

  // Load the ACH-mode tokenizer iframe.
  useEffect(() => {
    let cancelled = false
    fetch('/api/cardpointe/config?mode=echeck')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        if (d.iframeUrl) setIframeUrl(d.iframeUrl)
        else setErr(d.error || 'Bank entry unavailable')
      })
      .catch(() => {
        if (!cancelled) setErr('Bank entry unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // postMessage handler — same shape as the card path. The iframe
  // posts the account token in msg.message.token; we never see the
  // raw bank account number.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (typeof e.data !== 'string' || !e.data.startsWith('{')) return
      try {
        // CardSecure posts the token in TWO shapes depending on version:
        //   {"message":"<token>"}  ← message IS the token
        //   {"message":{"token":"…"}}
        // Only the object form was handled, so on an account serving the
        // string form no token was ever captured and the pay button could
        // not enable. Accept either.
        const raw = JSON.parse(e.data) as
          | { message?: string | { token?: string; validationError?: string } }
          | null
        const inner = raw?.message
        const tok =
          typeof inner === 'string' ? inner : typeof inner?.token === 'string' ? inner.token : ''
        const vErr =
          typeof inner === 'object' && typeof inner?.validationError === 'string'
            ? inner.validationError
            : ''
        if (tok) {
          setBankToken(tok)
          const tail = tok.slice(-4)
          if (/^\d{4}$/.test(tail)) setLast4(tail)
          setErr(null)
        } else if (vErr) {
          setBankToken(null)
          setLast4(null)
          setErr(vErr)
        }
      } catch {
        /* ignore non-JSON posts */
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const amount = Number(amountStr)
  const amountValid = Number.isFinite(amount) && amount > 0 && amount <= balance + 0.001
  const routingValid = /^\d{9}$/.test(routingNumber)
  const canSubmit =
    !!bankToken &&
    routingValid &&
    accountHolderName.trim().length > 1 &&
    amountValid &&
    !!nachaSignature &&
    consentChecked &&
    !submitting

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || !bankToken || !nachaSignature) return
    setSubmitting(true)
    setErr(null)
    try {
      const r = await fetch(`/api/portal/job/invoice/${invoice.id}/pay-ach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankAccountToken: bankToken,
          routingNumber,
          accountType,
          accountHolderName: accountHolderName.trim(),
          amount,
          last4,
          nachaSignatureData: nachaSignature,
          nachaText: consentText,
        }),
      })
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        retref?: string
        last4?: string | null
      }
      if (!r.ok || !data.ok) {
        setErr(data.error || `HTTP ${r.status}`)
        return
      }
      setSuccess({ last4: data.last4 ?? last4, amount })
      await onPaid()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 text-blue-900 text-sm px-4 py-3">
        Bank debit authorized: {fmtUsd(success.amount)}
        {success.last4 && <> from account ····{success.last4}</>}.
        <span className="block text-xs mt-1">
          Funds typically settle in 1–2 business days. We&rsquo;ll mark the invoice paid once your bank
          confirms the transfer.
        </span>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="text-[11px] text-gray-500">
        Balance due <span className="font-semibold text-gray-900">{fmtUsd(balance)}</span>. Account
        details are tokenized by CardPointe — SirReel never sees the raw bank account number.
      </div>

      <label className="block">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
          Account holder name
        </span>
        <input
          type="text"
          value={accountHolderName}
          onChange={(e) => setAccountHolderName(e.target.value)}
          placeholder="As it appears on the bank account"
          required
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-900"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
            Routing number
          </span>
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{9}"
            maxLength={9}
            value={routingNumber}
            onChange={(e) => setRoutingNumber(e.target.value.replace(/\D/g, ''))}
            placeholder="9 digits"
            required
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-900 font-mono"
          />
          {routingNumber.length > 0 && routingNumber.length !== 9 && (
            <div className="mt-1 text-[11px] text-rose-600">Must be exactly 9 digits.</div>
          )}
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
            Account type
          </span>
          <select
            value={accountType}
            onChange={(e) => setAccountType(e.target.value as 'C' | 'S')}
            className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-900"
          >
            <option value="C">Checking</option>
            <option value="S">Savings</option>
          </select>
        </label>
      </div>

      <div>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 block mb-1">
          Account number
        </span>
        <div
          className={`border rounded-lg overflow-hidden transition-colors ${
            bankToken ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 bg-white'
          }`}
          style={{ height: 48 }}
        >
          {iframeUrl ? (
            <iframe
              src={iframeUrl}
              frameBorder="0"
              scrolling="no"
              width="100%"
              height="48"
              title="Bank account entry"
            />
          ) : (
            <div className="px-3 py-2 text-xs text-gray-400">Loading bank entry…</div>
          )}
        </div>
        {bankToken && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-600 font-semibold">
            <span>✓</span>
            <span>
              Account captured securely{last4 ? <> · ····{last4}</> : null}
            </span>
          </div>
        )}
        {!bankToken && iframeUrl && (
          <div className="mt-1 text-[10px] text-gray-400">
            Encrypted by CardPointe before it leaves your browser.
          </div>
        )}
      </div>

      <label className="block">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
          Amount
        </span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          max={balance}
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-900"
        />
        {!amountValid && amountStr.length > 0 && (
          <div className="mt-1 text-[11px] text-rose-600">
            Enter an amount up to {fmtUsd(balance)}.
          </div>
        )}
      </label>

      {/* NACHA authorization — required for ACH. The bank can reverse
          unauthorized debits within ~60 days, so an explicit signature
          + consent record is essential. */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
          Authorization to debit your account
        </div>
        <div className="text-[12px] text-gray-700 leading-relaxed">{consentText}</div>
        <label className="flex items-start gap-2 text-[12px] text-gray-700">
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
            className="mt-0.5 accent-gray-900"
          />
          <span>
            I authorize this ACH debit and confirm I am the account holder or am authorized to act
            on behalf of the account holder.
          </span>
        </label>
        <div>
          <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 block mb-1">
            Signature
          </span>
          <SigCanvas
            onChange={setNachaSignature}
            placeholder="Sign to authorize"
          />
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs px-3 py-2">
          {err}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full bg-gray-900 text-white rounded-lg py-3 text-sm font-semibold hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        {submitting
          ? 'Authorizing bank debit…'
          : `Authorize ${fmtUsd(amount || balance)} debit`}
      </button>
      <div className="text-[10px] text-gray-400 leading-relaxed">
        Funds settle in 1–2 business days. The invoice will be marked paid automatically once your
        bank confirms the transfer.
      </div>
    </form>
  )
}
