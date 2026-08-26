'use client'

/**
 * Bank / ACH details, shown inside the authenticated job portal.
 *
 * These used to be emailed. Email is the channel invoice-redirect fraud
 * lives in: an attacker in the thread swaps the routing number, the client
 * pays them in good faith, and nobody finds out until the money never
 * arrives. A client cannot tell an altered email from a real one — but they
 * can trust numbers served from sirreel.com over TLS.
 *
 * Hence the warning banner: the single most effective control against this
 * fraud is telling the payer, in advance, that the details never change and
 * that any email saying otherwise is fake. It only works if they read it
 * BEFORE the fraudulent message arrives, which is why it sits here rather
 * than in a footer.
 */

import { useEffect, useState } from 'react'
import { ZelleDetails } from '@/components/payments/ZelleDetails'

interface Details {
  payeeName: string
  bankName: string | null
  accountType: string | null
  accountNumber: string
  routingAch: string
  routingWire: string | null
  remittanceEmail: string | null
  bankAddress: string | null
  instructions: string | null
  zelleHandle: string | null
  zelleName: string | null
}

function Row({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-gray-400 pt-0.5 shrink-0">
        {label}
      </span>
      <span className="flex items-center gap-2 min-w-0">
        <span className="text-sm text-gray-900 font-medium text-right break-words">{value}</span>
        <button
          type="button"
          onClick={() => {
            // Account and routing numbers get retyped into a bank portal, and
            // a transposed digit there is a payment sent nowhere recoverable.
            navigator.clipboard?.writeText(value).then(
              () => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              },
              () => {},
            )
          }}
          className="text-[10px] text-gray-400 hover:text-gray-900 shrink-0"
          aria-label={`Copy ${label}`}
        >
          {copied ? '✓' : 'copy'}
        </button>
      </span>
    </div>
  )
}

/**
 * Two portals render this, and they authenticate differently — the job portal
 * by signed session, the v2 paperwork portal by its PaperworkRequest token.
 * That is the ONLY difference, so it is a prop rather than a second copy of
 * the panel: the numbers, the copy buttons and the fraud warning have to stay
 * identical wherever a client reads them.
 */
export function PortalBankDetails({
  endpoint = '/api/portal/job/payment-details',
  /** The A/P share posts to a job-session route. Off wherever there is no
   *  job session to post with — see the note on ShareToAp. */
  showShare = true,
}: {
  endpoint?: string
  showShare?: boolean
} = {}) {
  const [details, setDetails] = useState<Details | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'none'>('loading')

  useEffect(() => {
    fetch(endpoint)
      .then((r) => r.json())
      .then((d) => {
        if (d?.configured && d.details) {
          setDetails(d.details)
          setState('ready')
        } else setState('none')
      })
      .catch(() => setState('none'))
  }, [endpoint])

  if (state === 'loading') {
    return <div className="text-xs text-gray-400">Loading payment details…</div>
  }
  // Say nothing rather than something vague. A client who sees a broken
  // panel here may go looking for the numbers in an old email, which is
  // exactly the habit this is meant to break.
  if (state === 'none' || !details) {
    return (
      <div className="text-xs text-gray-500">
        Contact{' '}
        <a href="mailto:billing@sirreel.com" className="underline">
          billing@sirreel.com
        </a>{' '}
        for payment details.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-600">
        Pay by ACH or wire using the details below. There is no processing fee
        on bank transfers.
      </p>

      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <Row label="Payee" value={details.payeeName} />
        <Row label="Bank" value={details.bankName} />
        <Row label="Account type" value={details.accountType} />
        <Row label="Account number" value={details.accountNumber} />
        <Row label="Routing (ACH)" value={details.routingAch} />
        <Row label="Routing (wire)" value={details.routingWire} />
        <Row label="Bank address" value={details.bankAddress} />
        <Row label="Remittance to" value={details.remittanceEmail} />
      </div>

      {details.instructions && (
        <p className="text-xs text-gray-600 whitespace-pre-line">{details.instructions}</p>
      )}

      <ZelleDetails handle={details.zelleHandle} name={details.zelleName} tone="compact" />

      {showShare && <ShareToAp />}

      <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <span className="font-semibold">These details never change.</span> SirReel
        will never email you asking to send payment to a different account. If
        you receive a message claiming our banking details have changed — even
        from a familiar address — call us at the number on your agreement before
        sending anything.
      </div>
    </div>
  )
}

/**
 * "Send to accounts payable" — the producer authorizes the job, but a
 * separate A/P department pays it. Without this they retype or forward the
 * numbers, which puts them back into email at the client's end.
 *
 * SirReel sends the link directly, so the account numbers never pass through
 * the producer's outbox and there is a record of who was sent what.
 *
 * Job portal only for now: the share route authenticates by job session and
 * rate-limits per session, and the v2 paperwork portal has neither. A client
 * there can still copy the numbers — they just can't have us mail the link
 * for them.
 */
function ShareToAp() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const send = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch('/api/portal/job/payment-details/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const d = await r.json().catch(() => ({}))
      if (d?.ok) {
        setMsg({ ok: true, text: `Sent to ${d.sentTo}.` })
        setEmail('')
      } else {
        setMsg({ ok: false, text: d?.error || 'Could not send that email.' })
      }
    } catch {
      setMsg({ ok: false, text: 'Could not send that email.' })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-gray-900 underline"
      >
        Send these details to your accounts payable team →
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-2">
      <p className="text-xs text-gray-600">
        We&rsquo;ll email them a secure link to this page. The message
        won&rsquo;t contain your account numbers.
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ap@productioncompany.com"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !email.trim()}
          className="px-3 py-2 rounded-lg bg-gray-900 text-white text-xs font-semibold disabled:opacity-40"
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      {msg && (
        <p className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>
      )}
    </div>
  )
}
