'use client'

/**
 * /portal/auth/sign-in — passwordless email entry.
 *
 * Single email field, posts to /api/portal/auth/request. The
 * response is neutral by design (we never confirm or deny whether
 * the email matches a Person), so the UI message is also neutral.
 */

import { useState } from 'react'

export default function PortalSignInPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ?error=link → set by /api/portal/auth/verify when a link is
  // missing/expired/used. Read once on mount; cleared on next submit.
  if (typeof window !== 'undefined' && !error) {
    const params = new URLSearchParams(window.location.search)
    if (params.get('error') === 'link') {
      setError('That sign-in link is invalid or has expired. Enter your email below to request a new one.')
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await fetch('/api/portal/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      // Always show success — neutral response surface.
      setSubmitted(true)
    } catch {
      // Network-level failure only. Don't reveal anything else.
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-900">Sign in</h1>
        <p className="text-sm text-zinc-600 mt-1">
          Enter the email address SirReel has on file. We'll send you a sign-in link.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm px-3 py-2">
            {error}
          </div>
        )}

        {submitted ? (
          <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 text-sm px-3 py-3">
            If that email is on file, we've sent a sign-in link. Check your inbox (and spam).
            The link expires in 30 minutes.
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm text-zinc-900 focus:outline-none focus:border-amber-500"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="w-full px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-300 text-white text-sm font-semibold rounded-lg"
            >
              {submitting ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
