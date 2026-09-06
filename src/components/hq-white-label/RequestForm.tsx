'use client'

/**
 * The request form on utliiz.com — replaces the mailto buttons (Wes
 * 2026-09-06). Lands a UtliizLead and mails VerMar; the visitor sees a
 * thank-you in place. Styled with the Utliiz palette (turquoise base),
 * not SirReel's.
 */
import { useState } from 'react'

const SIZES = [
  { v: '1-5', label: '1–5 units' },
  { v: '6-15', label: '6–15 units' },
  { v: '16-40', label: '16–40 units' },
  { v: '40+', label: 'More than 40' },
]

const INPUT = 'w-full rounded-xl border border-[#8FC2CE]/60 bg-white px-4 py-3 text-[16px] text-[#0f2a30] placeholder:text-[#7a9aa1] focus:outline-none focus:ring-4 focus:ring-[#CC0000]/12 focus:border-[#CC0000]'
const LABEL = 'block text-[13px] font-bold text-[#0f2a30] mb-1.5'

export function RequestForm({ compact = false }: { compact?: boolean }) {
  const [v, setV] = useState({ name: '', company: '', email: '', phone: '', fleetSize: '', fleetKind: '', note: '', website: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((p) => ({ ...p, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await fetch('/api/public/utliiz/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) })
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    setBusy(false)
    if (!r.ok) return setError(j.error ?? 'Something went wrong. Try again in a minute.')
    setDone(true)
  }

  if (done) {
    return (
      <div className="rounded-2xl bg-[#E4F1F4] border border-[#8FC2CE] px-6 py-8 text-center">
        <div className="text-[22px] font-black text-[#0f2a30]" style={{ fontFamily: 'var(--font-utliiz-display)' }}>Got it — we&rsquo;ll be in touch.</div>
        <p className="mt-2 text-[15px] text-[#0f2a30]/80 max-w-[44ch] mx-auto">We set workspaces up by hand so yours starts with your fleet already in it. Expect an email from a person, usually the same day.</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className={`grid gap-4 ${compact ? '' : 'sm:grid-cols-2'}`}>
        <div>
          <label className={LABEL}>Your name</label>
          <input className={INPUT} value={v.name} onChange={set('name')} required autoComplete="name" />
        </div>
        <div>
          <label className={LABEL}>Company</label>
          <input className={INPUT} value={v.company} onChange={set('company')} required autoComplete="organization" />
        </div>
        <div>
          <label className={LABEL}>Email</label>
          <input className={INPUT} type="email" value={v.email} onChange={set('email')} required autoComplete="email" />
        </div>
        <div>
          <label className={LABEL}>Phone <span className="font-normal text-[#7a9aa1]">(optional)</span></label>
          <input className={INPUT} type="tel" value={v.phone} onChange={set('phone')} autoComplete="tel" />
        </div>
        <div>
          <label className={LABEL}>How many units do you run?</label>
          <select className={INPUT} value={v.fleetSize} onChange={set('fleetSize')}>
            <option value="">Pick one</option>
            {SIZES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL}>What kind?</label>
          <input className={INPUT} value={v.fleetKind} onChange={set('fleetKind')} placeholder="star wagons, honeywagons, cube trucks…" />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL}>Anything you want it to do for you? <span className="font-normal text-[#7a9aa1]">(optional)</span></label>
          <textarea className={`${INPUT} min-h-[84px]`} value={v.note} onChange={set('note')} />
        </div>
        {/* Honeypot — hidden from people, filled by bots. */}
        <input tabIndex={-1} autoComplete="off" value={v.website} onChange={set('website')} className="hidden" aria-hidden="true" name="website" />
      </div>
      {error && <div className="rounded-xl border border-[#f2c9c9] bg-[#fff5f5] px-4 py-3 text-[14px] text-[#991b1b]">{error}</div>}
      <button type="submit" disabled={busy} className="inline-flex items-center justify-center rounded-full bg-[#CC0000] hover:bg-[#A30000] px-7 py-3.5 text-[16px] font-bold text-white transition-colors disabled:opacity-60">
        {busy ? 'Sending…' : 'Request a workspace'}
      </button>
      <p className="text-[13px] text-[#7a9aa1]">No card, no contract. A person reads every request.</p>
    </form>
  )
}
