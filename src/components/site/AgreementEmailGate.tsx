'use client'

/**
 * Email gate on the public /rental-agreement page ("To fill this out, enter
 * your email"). Posts to /api/public/rental-agreement/request-entry and shows
 * ONLY the endpoint's constant neutral message — this component never learns
 * (and can never leak) whether the address matched anything; all branching
 * happens in the emailed message. Honeypot mirrors the other public intakes.
 */
import { useState } from 'react'

export function AgreementEmailGate() {
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
      const r = await fetch('/api/public/rental-agreement/request-entry', {
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
      <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#c39a3f]" style={{ fontFamily: 'Archivo, sans-serif' }}>
        Ready to fill this out?
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#cfc9bd]">
        Enter your email and we&rsquo;ll send you a link to sign for your job.
      </p>
      {msg ? (
        <p className="mt-3 text-[12.5px] leading-relaxed text-[#e7e2d5] bg-white/[0.07] border border-white/10 rounded-lg px-3 py-2">{msg}</p>
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
          <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, opacity: 0 }} placeholder="website" />
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
    </div>
  )
}
