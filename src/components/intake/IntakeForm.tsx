'use client'

import { useState } from 'react'

/**
 * Public client-intake form. Mirrors the hardening contract of
 * /order/supplies — the same honeypot field name (`website`) is
 * included so the server's silent-success fast-path stays consistent
 * across both public surfaces.
 *
 * Posts to /api/public/intake. The endpoint never trusts an
 * authenticated session — attribution to a sales agent is via the
 * `agentSlug` field, which the server validates against
 * isActive + role=AGENT before stamping Inquiry.assignedToId.
 *
 * Honeypot UX rule: the input is rendered but visually hidden +
 * marked tabIndex=-1 + autoComplete=off so a human filling the
 * form never sees or focuses it; only spam bots that fill every
 * input will populate it.
 */
export interface IntakeFormProps {
  /** When the page is /intake/<slug>, the resolved agent's display
   *  name — used to greet the visitor ("Reach out via Jose…").
   *  Null/undefined on the generic /intake page or when the slug
   *  didn't resolve to an active AGENT. */
  agentName?: string | null
  /** The agent's publicSlug, passed through unchanged to the server
   *  for attribution. Empty string when no slug in the URL. */
  agentSlug?: string | null
}

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'ok'; reference: string }
  | { kind: 'error'; message: string }

export function IntakeForm({ agentName, agentSlug }: IntakeFormProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [jobName, setJobName] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (status.kind === 'sending') return
    setStatus({ kind: 'sending' })
    try {
      const res = await fetch('/api/public/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact: { name, phone, email },
          jobName,
          agentSlug: agentSlug || null,
          website, // honeypot — empty for real submissions
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setStatus({
          kind: 'error',
          message: data?.error || `Submit failed (HTTP ${res.status})`,
        })
        return
      }
      setStatus({ kind: 'ok', reference: data.reference || '' })
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      })
    }
  }

  if (status.kind === 'ok') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <div className="text-lg font-semibold text-emerald-900">Request received</div>
        <p className="mt-2 text-sm text-emerald-800">
          Your SirReel agent will follow up shortly.
        </p>
        {status.reference && (
          <p className="mt-3 text-xs text-emerald-700 font-mono">{status.reference}</p>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {agentName && (
        <div className="text-sm text-gray-600">
          Reaching out via{' '}
          <span className="font-semibold text-gray-900">{agentName}</span>.
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
          Your name
        </label>
        <input
          type="text"
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
          Phone
        </label>
        <input
          type="tel"
          required
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
          Email
        </label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
          Job / production name
        </label>
        <input
          type="text"
          required
          value={jobName}
          onChange={(e) => setJobName(e.target.value)}
          placeholder="e.g. Untitled HBO Pilot"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-gray-900"
        />
      </div>

      {/* Honeypot — same field name as /order/supplies. Bots that
          fill every field populate this; humans never see or focus
          it (visually hidden + tabIndex=-1 + autoComplete=off). */}
      <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
        <label>
          Website (leave empty)
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>

      {status.kind === 'error' && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {status.message}
        </div>
      )}

      <button
        type="submit"
        disabled={status.kind === 'sending'}
        className="w-full rounded-xl bg-gray-900 hover:bg-black disabled:bg-gray-400 text-white text-sm font-semibold py-2.5 transition-colors"
      >
        {status.kind === 'sending' ? 'Sending…' : 'Send request'}
      </button>
    </form>
  )
}
