'use client'

import { useState, type FormEvent } from 'react'

/**
 * "Check Availability" form for the public Standing Sets page. Posts to
 * /api/public/space-inquiry (rate-limited, honeypot, Turnstile-gated),
 * which lands an Inquiry(source WEB_FORM) in the staff pipeline. No
 * auto-reply.
 *
 * The set checkboxes are DRIVEN by the published sets passed in (not
 * hardcoded) — only client-visible standing sets appear. The server
 * re-validates the selected ids, so the list here is purely UX.
 */
export interface AvailabilitySet {
  id: string
  name: string
}

export function StandingSetAvailabilityForm({ sets }: { sets: AvailabilitySet[] }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [website, setWebsite] = useState('') // honeypot
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const valid =
    name.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || status === 'sending') return
    setStatus('sending')
    setError(null)
    try {
      const res = await fetch('/api/public/space-inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          message: message.trim(),
          startDate: startDate || null,
          endDate: endDate || null,
          spaceIds: [...selected],
          website,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'Something went wrong — please try again.')
        setStatus('error')
        return
      }
      setStatus('sent')
    } catch {
      setError('Network error — please try again.')
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="rounded-2xl bg-white/5 border border-white/10 p-8 text-center">
        <div className="w-14 h-14 mx-auto rounded-full bg-[#3f7d52] inline-flex items-center justify-center mb-4">
          <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h3 className="font-black text-[22px] tracking-tight text-white" style={{ fontFamily: 'Archivo, sans-serif' }}>
          Thanks — we&rsquo;ll be in touch.
        </h3>
        <p className="text-[#a8a294] text-[14.5px] mt-2">
          A SirReel team member will confirm availability shortly.
        </p>
      </div>
    )
  }

  const inputCls =
    'w-full bg-white/5 border border-white/15 rounded-lg px-4 py-3 text-[15px] text-white placeholder:text-[#6d685e] outline-none focus:border-[#c39a3f] transition-colors'
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a8a294] mb-1.5'

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {/* Honeypot */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Website
          <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>

      {/* Set multi-select */}
      {sets.length > 0 && (
        <div>
          <span className={labelCls}>Which sets? (select any)</span>
          <div className="flex flex-wrap gap-2">
            {sets.map((s) => {
              const on = selected.has(s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  aria-pressed={on}
                  className={`rounded-full border-[1.5px] px-4 py-2 text-[13.5px] font-semibold transition-colors ${
                    on
                      ? 'border-[#c39a3f] bg-[#c39a3f] text-[#0c0c0d]'
                      : 'border-white/25 text-[#cfc9bd] hover:border-white/50'
                  }`}
                  style={{ fontFamily: 'Archivo, sans-serif' }}
                >
                  {s.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="ssa-name">Name</label>
          <input id="ssa-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="ssa-email">Email</label>
          <input id="ssa-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@production.com" className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="ssa-start">Start date</label>
          <input id="ssa-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="ssa-end">End date</label>
          <input id="ssa-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div>
        <label className={labelCls} htmlFor="ssa-msg">Details</label>
        <textarea
          id="ssa-msg"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Crew size, shoot dates, what you're looking for…"
          rows={4}
          maxLength={5000}
          className={`${inputCls} resize-y min-h-[110px]`}
        />
      </div>

      {error && <div className="text-[13px] text-rose-300">{error}</div>}

      <button
        type="submit"
        disabled={!valid || status === 'sending'}
        className="self-start inline-flex items-center rounded-full border-[1.5px] border-[#c39a3f] text-[#c39a3f] hover:bg-[#c39a3f] hover:text-[#0c0c0d] px-7 py-3 text-[13px] font-bold uppercase tracking-[0.08em] transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#c39a3f]"
        style={{ fontFamily: 'Archivo, sans-serif' }}
      >
        {status === 'sending' ? 'Sending…' : 'Check Availability'}
      </button>
    </form>
  )
}
