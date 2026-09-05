'use client'

import { useState } from 'react'

/**
 * The "Start" form on the "See what HQ can do for you" page. Posts to the
 * partner-token route, then sends the browser straight into the new
 * workspace — the link is emailed too, so it isn't lost when the tab is.
 */
export function StartHqTrialForm({ token, initial, trialDays, accent }: { token: string; initial: { name: string; email: string }; trialDays: number; accent: string }) {
  const [name, setName] = useState(initial.name)
  const [email, setEmail] = useState(initial.email)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/public/vendor-account/${token}/hq/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, note }),
    })
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
    if (!res.ok || !data.url) {
      setBusy(false)
      setError(data.error ?? 'Something went wrong. Try again in a minute.')
      return
    }
    window.location.href = data.url
  }

  const input = 'w-full rounded-lg border border-[#d6d1c4] bg-white px-3 py-2.5 text-[15px] text-[#111] focus:outline-none focus:ring-2 focus:ring-black/10'
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
        <input className={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" type="email" required />
      </div>
      <textarea className={`${input} min-h-[70px]`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything you'd want it to do for you? (optional)" />
      {error && <div className="rounded-lg border border-[#f2c9c9] bg-[#fff5f5] px-4 py-2.5 text-[14px] text-[#991b1b]">{error}</div>}
      <button type="submit" disabled={busy} className="inline-flex items-center justify-center rounded-lg px-5 py-3 text-[15px] font-bold text-white disabled:opacity-60" style={{ background: accent }}>
        {busy ? 'Setting up your workspace…' : `Start your free ${trialDays}-day trial →`}
      </button>
      <p className="text-[12px] text-[#6b6560]">No card needed. Your link is emailed to you the moment it&apos;s ready.</p>
    </form>
  )
}
