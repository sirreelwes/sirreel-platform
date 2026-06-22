'use client'

/**
 * /portal/auth/sign-in — passwordless email entry.
 *
 * Single email field, posts to /api/portal/auth/request. The
 * response is neutral by design (we never confirm or deny whether
 * the email matches a Person), so the UI message is also neutral.
 *
 * TSX cohesion: dark hero (white wordmark + gold "PRESENTS / TSX"
 * lockup + serif welcome), light cream body, gold CTA. Matches the
 * /portal/[token] page so a client who arrives here from any TSX
 * touchpoint sees the same shell.
 */

import { useState } from 'react'
import { TSX, TSX_SERIF } from '@/lib/brand/tsxTokens'

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
      setSubmitted(true)
    } catch {
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F7F4] flex flex-col">
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {/* TSX dark hero — mirrors /portal/[token]/page.tsx */}
      <div className="w-full" style={{ backgroundColor: TSX.dark }}>
        <div className="max-w-md mx-auto px-5 pt-7 pb-7 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sirreel-logo-white.png"
            alt="SirReel Studio Services"
            width={180}
            style={{ display: 'inline-block', maxWidth: 180, height: 'auto' }}
          />
          <div className="mx-auto mt-3" style={{ width: 48, height: 2, backgroundColor: TSX.gold }} />
          <div
            className="mt-3 text-[10px] uppercase font-semibold"
            style={{ color: TSX.gold, letterSpacing: '2.5px' }}
          >
            Presents
          </div>
          <div className="mt-1 text-white text-[28px] font-light tracking-[5px]">TSX</div>
          <h1
            className="mt-4 text-white text-[24px] font-light italic leading-tight"
            style={{ fontFamily: TSX_SERIF }}
          >
            Sign in to your portal.
          </h1>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-10">
        <div className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl p-8 shadow-sm">
          <p className="text-sm text-zinc-600">
            Enter the email address SirReel has on file. We&apos;ll send you a sign-in link.
          </p>

          {error && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm px-3 py-2">
              {error}
            </div>
          )}

          {submitted ? (
            <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 text-sm px-3 py-3">
              If that email is on file, we&apos;ve sent a sign-in link. Check your inbox (and spam).
              The link expires in 30 minutes.
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-3">
              <div>
                <label
                  className="block text-[10px] font-semibold uppercase mb-1"
                  style={{ color: '#888', letterSpacing: '1.5px' }}
                >
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
                  className="w-full px-3 py-2.5 border border-zinc-300 rounded-lg text-sm text-zinc-900 focus:outline-none"
                  style={{ borderColor: '#d4d4d4' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = TSX.gold }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#d4d4d4' }}
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !email.trim()}
                className="w-full px-4 py-2.5 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: submitting || !email.trim() ? '#bfbfbf' : TSX.gold }}
                onMouseEnter={(e) => { if (!submitting && email.trim()) e.currentTarget.style.backgroundColor = TSX.goldHover }}
                onMouseLeave={(e) => { if (!submitting && email.trim()) e.currentTarget.style.backgroundColor = TSX.gold }}
              >
                {submitting ? 'Sending…' : 'Send sign-in link'}
              </button>
            </form>
          )}
        </div>
      </div>

      <footer className="mt-10 border-t border-gray-200" style={{ backgroundColor: '#fafaf8' }}>
        <div className="max-w-md mx-auto px-5 py-6 text-center">
          <div
            className="text-[18px]"
            style={{ fontFamily: TSX_SERIF, color: '#777', letterSpacing: '0.5px' }}
          >
            SirReel
          </div>
          <p className="mt-2 text-[10px] tracking-wide leading-relaxed" style={{ color: '#888' }}>
            SirReel Studio Services<br />
            8500 Lankershim Blvd, Sun Valley, CA 91352
          </p>
          <p className="mt-2 text-[11px]" style={{ color: TSX.gold }}>
            After-hours: <a href="tel:8884777335" style={{ color: TSX.gold }}>(888) 477-7335</a>
          </p>
        </div>
      </footer>
    </div>
  )
}
