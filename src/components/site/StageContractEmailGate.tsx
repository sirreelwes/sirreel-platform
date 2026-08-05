'use client'

/**
 * Email gate on the public /stage-contract page — the studio counterpart to
 * AgreementEmailGate. Posts to /api/public/stage-contract/request-entry and
 * shows ONLY that endpoint's constant neutral message, so this component
 * never learns (and can never leak) whether the address matched anything.
 * All branching happens in the emailed message.
 *
 * The copy says "request" rather than "sign now" on purpose. A stage
 * contract carries negotiated terms — rate, day length, overtime — that a
 * SirReel agent sets, so unlike the rental agreement there is no
 * self-service path to a signable document. Promising one here would set up
 * the client to be disappointed by the email that follows.
 */
import Link from 'next/link'
import { useState } from 'react'

export function StageContractEmailGate() {
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const r = await fetch('/api/public/stage-contract/request-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, website }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErr(d.error || 'Something went wrong — try again shortly.')
        return
      }
      setMsg(d.message || "If we have an account for that address, you'll receive an email with next steps.")
      setEmail('')
    } catch {
      setErr('Network error — try again shortly.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white/[0.06] border border-white/15 rounded-xl p-4 w-full max-w-[340px]">
      <div
        className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#c39a3f]"
        style={{ fontFamily: 'Archivo, sans-serif' }}
      >
        Ready to sign?
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#cfc9bd]">
        Enter your email and we&rsquo;ll send you a link to review and sign the contract for your booking.
      </p>
      {msg ? (
        <p className="mt-3 text-[12.5px] leading-relaxed text-[#e7e2d5] bg-white/[0.07] border border-white/10 rounded-lg px-3 py-2">
          {msg}
        </p>
      ) : (
        <form onSubmit={submit} className="mt-3 flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={320}
            placeholder="you@production.com"
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white text-[#1a1a1a] text-[13px] placeholder:text-[#9a927e] border-0 focus:outline-none"
          />
          {/* Honeypot */}
          <input
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, opacity: 0 }}
            placeholder="website"
          />
          <button
            type="submit"
            disabled={busy}
            className="flex-none bg-[#c39a3f] hover:bg-[#d4ab50] text-[#0c0c0d] font-bold text-[13px] px-4 py-2 rounded-lg disabled:opacity-50"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            {busy ? '…' : 'Send'}
          </button>
        </form>
      )}
      {err && <p className="mt-2 text-[11.5px] text-rose-300 m-0">{err}</p>}

      {/* Shown in BOTH states, for the same reason as the rental gate: the
          neutral response can't say whether the address matched, so without
          a standing route forward anyone who isn't a client yet hits a dead
          end. This helps them without signalling anything. */}
      <p className="mt-3 pt-3 border-t border-white/10 text-[12px] leading-relaxed text-[#a8a294] m-0">
        Haven&rsquo;t booked a stage yet?{' '}
        <Link
          href={`/contact?prefill=${encodeURIComponent("I'd like to book a stage or standing set.")}`}
          className="font-semibold text-[#c39a3f] hover:text-[#d4ab50] underline"
        >
          Tell us about your production &rarr;
        </Link>
      </p>
    </div>
  )
}
