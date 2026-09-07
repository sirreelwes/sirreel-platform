'use client'

/**
 * "Talk to us" on the product site (utliiz.com/#contact). Posts to
 * /api/public/vendor-hq/contact, which emails VerMar's ops inbox. This
 * exists because there is no mailbox on the product's domain yet — see
 * the route's header. Dark-surface styling to sit on the site's navy.
 */

import { useState } from 'react'

const FIELD = 'w-full rounded-lg border border-white/20 bg-white/5 px-3.5 py-2.5 text-[15px] text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[var(--site-accent)]/40 focus:border-[var(--site-accent)]'
const LABEL = 'block text-[12px] font-semibold uppercase tracking-[1.4px] text-white/60 mb-1.5'

export function SiteContactForm({ accent }: { accent: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (state === 'sending') return
    const fd = new FormData(e.currentTarget)
    const payload = Object.fromEntries(['name', 'email', 'company', 'units', 'message', 'website'].map((k) => [k, String(fd.get(k) ?? '')]))
    setState('sending'); setError(null)
    try {
      const res = await fetch('/api/public/vendor-hq/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (res.ok && data.ok) { setState('sent'); return }
      setError(data.error || 'Something went wrong. Please try again.'); setState('error')
    } catch {
      setError('Something went wrong. Please try again.'); setState('error')
    }
  }

  if (state === 'sent') {
    return (
      <div className="rounded-2xl border border-white/15 p-6">
        <div className="text-[18px] font-bold">Got it — thank you.</div>
        <p className="mt-2 text-[14px] leading-relaxed text-white/70">We read every message ourselves and will reply from a real person, usually within a business day.</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="relative rounded-2xl border border-white/15 p-6 grid gap-4" style={{ ['--site-accent' as string]: accent }}>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="c-name" className={LABEL}>Your name</label>
          <input id="c-name" name="name" required maxLength={200} autoComplete="name" className={FIELD} />
        </div>
        <div>
          <label htmlFor="c-email" className={LABEL}>Work email</label>
          <input id="c-email" name="email" type="email" required maxLength={320} autoComplete="email" className={FIELD} />
        </div>
        <div>
          <label htmlFor="c-company" className={LABEL}>Company</label>
          <input id="c-company" name="company" required maxLength={200} autoComplete="organization" className={FIELD} />
        </div>
        <div>
          <label htmlFor="c-units" className={LABEL}>Roughly how many units</label>
          <input id="c-units" name="units" maxLength={40} inputMode="numeric" placeholder="e.g. 12" className={FIELD} />
        </div>
      </div>
      <div>
        <label htmlFor="c-message" className={LABEL}>Anything else</label>
        <textarea id="c-message" name="message" rows={4} maxLength={5000} placeholder="What you run, what you're doing by hand today, when you'd like to start." className={FIELD} />
      </div>
      {/* Honeypot — hidden from people, filled by bots. The API treats a value here as spam. */}
      <div className="absolute left-[-9999px] w-px h-px overflow-hidden" aria-hidden="true">
        <label htmlFor="c-website">Website</label>
        <input id="c-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {error && <div role="alert" className="text-[14px] text-[#ffb4b4]">{error}</div>}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={state === 'sending'} className="rounded-lg px-5 py-3 text-[15px] font-bold text-[#0f1523] disabled:opacity-60" style={{ background: accent }}>
          {state === 'sending' ? 'Sending…' : 'Send'}
        </button>
        <span className="text-[13px] text-white/50">No card, no auto-reply, no list. A person answers.</span>
      </div>
    </form>
  )
}
