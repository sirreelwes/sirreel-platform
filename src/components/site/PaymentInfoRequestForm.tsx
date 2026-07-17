'use client'

/**
 * Payment-info request form — one email field. The confirmation copy is
 * UNIFORM for known and unknown addresses (server enforces the same);
 * never branch the UI on match status.
 */

import { useState } from 'react'

export function PaymentInfoRequestForm() {
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/public/payment-info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, website }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'Something went wrong — try again.')
        return
      }
      setDone(
        json.message ||
          "If that address is on file, we've just emailed your payment info. If not, a SirReel agent will reach out.",
      )
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="bg-[#141414] border border-[#2e2e30] rounded-2xl p-8">
        <div className="text-3xl mb-3">📬</div>
        <div className="text-lg font-bold" style={{ fontFamily: 'Archivo, sans-serif' }}>Request received</div>
        <p className="text-[#a8a294] text-[14px] leading-relaxed mt-2 max-w-[52ch]">{done}</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="bg-[#141414] border border-[#2e2e30] rounded-2xl p-8">
      <label className="block">
        <span className="text-[12px] font-semibold tracking-[0.14em] uppercase text-[#a8a294]" style={{ fontFamily: 'Archivo, sans-serif' }}>
          Your email
        </span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@production.com"
          className="mt-2 w-full bg-[#0c0c0d] border border-[#2e2e30] rounded-lg px-4 py-3 text-[15px] text-white placeholder:text-[#5c574d] outline-none focus:border-[#c39a3f]"
        />
      </label>
      {/* Honeypot — hidden from humans */}
      <input
        type="text"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      {error && <div className="text-[13px] text-red-400 mt-3">{error}</div>}
      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full bg-[#c39a3f] hover:bg-[#d4a547] text-[#0c0c0d] font-extrabold text-[14px] tracking-wide uppercase rounded-lg px-5 py-3.5 transition-colors disabled:opacity-60"
        style={{ fontFamily: 'Archivo, sans-serif' }}
      >
        {busy ? 'Sending…' : 'Send my payment info'}
      </button>
      <p className="text-[12px] text-[#8b857a] leading-relaxed mt-4">
        For security, payment details are only ever delivered by email to the address we have on
        file. SirReel&rsquo;s payment details never change — if you receive any notice of updated
        banking information, call 888.477.7335 before sending funds.
      </p>
    </form>
  )
}
