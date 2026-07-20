'use client'

import { useState, type FormEvent } from 'react'

/**
 * "Get in Touch" form for the public Home contact band. Posts to
 * /api/public/contact (rate-limited, honeypot, Turnstile-gated) which
 * lands an Inquiry(source WEB_FORM) in the staff pipeline. No auto-reply.
 *
 * `defaultMessage` seeds the message box — used by the nav's mode-aware
 * links (Equipment "Request a quote", Forms "Payment Info & ACH") which
 * deep-link to /home?prefill=…#contact so the agent sees exactly what
 * was requested.
 */
export function ContactForm({ defaultMessage = '' }: { defaultMessage?: string }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState(defaultMessage)
  const [website, setWebsite] = useState('') // honeypot
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const valid =
    name.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    message.trim().length > 0

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || status === 'sending') return
    setStatus('sending')
    setError(null)
    try {
      const res = await fetch('/api/public/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), message: message.trim(), website }),
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
          A SirReel team member will follow up shortly.
        </p>
      </div>
    )
  }

  const inputCls =
    'w-full bg-white/5 border border-white/15 rounded-lg px-4 py-3 text-[15px] text-white placeholder:text-[#6d685e] outline-none focus:border-[#c39a3f] transition-colors'

  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      {/* Honeypot — visually hidden */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Website
          <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          aria-label="Name"
          className={inputCls}
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          aria-label="Email"
          className={inputCls}
        />
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Tell us about your production — what you need and when…"
        aria-label="Message"
        rows={5}
        maxLength={5000}
        className={`${inputCls} resize-y min-h-[120px]`}
      />

      {error && <div className="text-[13px] text-rose-300">{error}</div>}

      <button
        type="submit"
        disabled={!valid || status === 'sending'}
        className="self-start inline-flex items-center rounded-full border-[1.5px] border-[#c39a3f] text-[#c39a3f] hover:bg-[#c39a3f] hover:text-[#0c0c0d] px-7 py-3 text-[13px] font-bold uppercase tracking-[0.08em] transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#c39a3f]"
        style={{ fontFamily: 'Archivo, sans-serif' }}
      >
        {status === 'sending' ? 'Sending…' : 'Send Message'}
      </button>
    </form>
  )
}
