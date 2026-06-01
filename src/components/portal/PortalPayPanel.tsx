'use client'

/**
 * PortalPayPanel — client-portal invoice pay surface.
 *
 * Phase 6 commit 2 — card path live. ACH path stub gated behind
 * NEXT_PUBLIC_ACH_ENABLED env flag, default off (Commit 3 wires it
 * up).
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

interface PortalInvoice {
  id: string
  invoiceNumber: string
  type: 'RENTAL' | 'LD'
  status: 'SENT' | 'PARTIAL' | 'PAID'
  total: string
  amountPaid: string
  balanceDue: string
  sentAt: string | null
  paidAt: string | null
  createdAt: string
  payable: boolean
}

const ACH_ENABLED = process.env.NEXT_PUBLIC_ACH_ENABLED === 'true'

function fmtUsd(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function PortalPayPanel() {
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
            invoice.status === 'PAID'
              ? 'bg-emerald-100 text-emerald-700'
              : invoice.status === 'PARTIAL'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-blue-100 text-blue-700'
          }`}
        >
          {invoice.status}
        </span>
        <span className="text-sm font-semibold text-gray-900 ml-auto">{fmtUsd(total)}</span>
        {paid > 0 && (
          <span className="text-[11px] text-emerald-600">−{fmtUsd(paid)} paid</span>
        )}
        {balance > 0 && (
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
          PDF →
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
      {expanded && invoice.payable && (
        <div className="px-4 py-4 bg-gray-50">
          <PayForm invoice={invoice} onPaid={onPaid} />
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
        <AchPlaceholder />
      )}
    </div>
  )
}

function AchPlaceholder() {
  return (
    <div className="text-xs text-gray-500 italic">
      Bank (eCheck) coming soon.
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
  const [cardToken, setCardToken] = useState<string | null>(null)
  const [last4, setLast4] = useState<string | null>(null)
  const [cardholderName, setCardholderName] = useState('')
  const [amountStr, setAmountStr] = useState(balance.toFixed(2))
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [success, setSuccess] = useState<{
    last4: string | null
    amount: number
    orderClosed: boolean
  } | null>(null)

  // Load the CardSecure iframe URL.
  useEffect(() => {
    let cancelled = false
    fetch('/api/cardpointe/config')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
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
        const msg = JSON.parse(e.data) as {
          message?: { token?: string; validationError?: string }
        }
        const inner = msg.message
        if (!inner) return
        if (typeof inner.token === 'string' && inner.token.length > 0) {
          setCardToken(inner.token)
          // Token shape on CardConnect is a 16-character numeric or
          // alphanumeric string mirroring the card BIN+last4 pattern
          // — last4 is at the end. Defensive extraction.
          const tail = inner.token.slice(-4)
          if (/^\d{4}$/.test(tail)) setLast4(tail)
          setErr(null)
        } else if (typeof inner.validationError === 'string' && inner.validationError) {
          setCardToken(null)
          setLast4(null)
          setErr(inner.validationError)
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
  const canSubmit = !!cardToken && cardholderName.trim().length > 1 && amountValid && !submitting

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
        amount,
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
        Payment received: {fmtUsd(success.amount)}
        {success.last4 && <> on card ····{success.last4}</>}.
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
              height="48"
              title="Card Entry"
            />
          ) : (
            <div className="px-3 py-2 text-xs text-gray-400">Loading card entry…</div>
          )}
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
        {submitting ? 'Charging card…' : `Pay ${fmtUsd(amount || balance)}`}
      </button>
    </form>
  )
}
