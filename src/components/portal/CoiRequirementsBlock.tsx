'use client'

/**
 * "What your insurance needs to show" — inside the portal's COI row.
 *
 * The problem it solves is a round trip, not a missing document. Clients ask
 * their broker for a certificate, the broker issues one without Auto Physical
 * Damage, we bounce it, and a day goes. Auto Physical Damage is the line that
 * comes back missing most often — not because the coverage is absent, but
 * because some brokers itemise it and others treat it as implied. So it is
 * called out in amber here and the ask names both remedies: add it, or confirm
 * in writing that it's included.
 *
 * Two ways out: download the sample certificate, or have us email the
 * requirements straight to the broker. The second is the one that saves the
 * day — the wording reaches the person who writes the certificate without
 * being paraphrased on the way.
 */

import { useState } from 'react'
import { COI_REQUIREMENTS, STICKING_POINT, CERTIFICATE_HOLDER } from '@/lib/coi/requirements'

export function CoiRequirementsBlock() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    setSending(true)
    setError(null)
    try {
      const r = await fetch('/api/portal/job/coi-requirements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: email.trim() }),
      })
      const j = await r.json()
      if (!r.ok) {
        setError(j.error ?? "That didn't send. Try again in a moment.")
        return
      }
      setSentTo(j.to)
      setEmail('')
    } catch {
      setError("That didn't send — check your connection and try again.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-[#FBFAF8] p-3 space-y-2.5">
      <div className="text-xs font-bold text-gray-900">What your insurance needs to show</div>

      <ul className="space-y-1.5 text-[11px] text-gray-700 leading-relaxed">
        {COI_REQUIREMENTS.map((r) => (
          <li key={r.label}>
            <span className="font-semibold text-gray-900">{r.label}</span>
            {r.details && (
              <ul className="mt-0.5 ml-3 space-y-0.5">
                {r.details.map((d) => (
                  <li
                    key={d}
                    className={d === STICKING_POINT ? 'text-amber-700 font-semibold' : 'text-gray-500'}
                  >
                    · {d}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 leading-relaxed">
        <span className="font-semibold">Auto Physical Damage is the one that holds things up.</span>{' '}
        Some brokers list it on the certificate and some don&apos;t. If it isn&apos;t there we need it
        added — or written confirmation that it&apos;s included. Either works.
      </div>

      <div className="text-[10px] text-gray-500 leading-relaxed">
        Certificate holder, additional insured and loss payee:{' '}
        <span className="text-gray-700">{CERTIFICATE_HOLDER.name}, {CERTIFICATE_HOLDER.address}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <a
          href="/api/public/forms/coi"
          target="_blank"
          rel="noreferrer"
          className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Download sample COI
        </a>
        {!open && !sentTo && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="px-3 py-1.5 text-[11px] font-bold rounded-lg bg-gray-900 text-white hover:bg-gray-800"
          >
            Send to my insurance agent
          </button>
        )}
      </div>

      {sentTo && (
        <div className="text-[11px] text-green-700 font-semibold">
          Sent to {sentTo} — you&apos;re copied, and their reply comes to you.{' '}
          <button
            type="button"
            onClick={() => { setSentTo(null); setOpen(true) }}
            className="underline font-normal text-gray-600 hover:text-gray-900"
          >
            Send to someone else
          </button>
        </div>
      )}

      {open && !sentTo && (
        <div className="space-y-1.5">
          <label className="block text-[10px] uppercase tracking-widest text-gray-400 font-semibold" htmlFor="coi-agent">
            Your broker or agent&apos;s email
          </label>
          <div className="flex gap-2">
            <input
              id="coi-agent"
              type="email"
              value={email}
              placeholder="agent@brokerage.com"
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 min-w-0 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            />
            <button
              type="button"
              onClick={send}
              disabled={sending || !email.trim()}
              className="px-3 py-2 text-xs font-bold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
          <p className="text-[10px] text-gray-500">
            We&apos;ll email them the requirements above and the sample certificate. You&apos;ll be
            copied, and anything they reply comes back to you.
          </p>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}

export default CoiRequirementsBlock
