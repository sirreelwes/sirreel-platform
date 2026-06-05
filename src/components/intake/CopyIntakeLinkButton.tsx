'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'

/**
 * Small "Copy client-intake link" button. Renders ONLY for a logged-
 * in sales rep (role=AGENT AND salesOnly=true) that has a
 * publicSlug. Everyone else gets null, so the call site can drop
 * <CopyIntakeLinkButton/> in a header row without role-checking.
 *
 * The link itself is `window.location.origin/intake/<slug>` —
 * computed client-side so it's correct in preview AND prod without
 * any env helper, and Hugo isn't blocked behind an env var the
 * first time he tries it on a Vercel preview URL.
 *
 * Copy feedback mirrors the EmailActionPanel pattern: inline
 * `copied` boolean + 2s setTimeout. No global toast in this app.
 */
export function CopyIntakeLinkButton({ className = '' }: { className?: string }) {
  const { data: session } = useSession()
  const user = session?.user as
    | { role?: string; salesOnly?: boolean; publicSlug?: string | null }
    | undefined
  const [copied, setCopied] = useState(false)

  const slug = user?.publicSlug || null
  const isSalesRep = user?.role === 'AGENT' && user?.salesOnly === true
  if (!isSalesRep || !slug) return null

  const onClick = async () => {
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    const link = `${base}/intake/${slug}`
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard denied — fall back to a visible prompt so the rep
      // can copy manually. Rare path; happens in non-https previews.
      window.prompt('Copy this link:', link)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={`Share this link to capture leads attributed to you: /intake/${slug}`}
      className={
        `text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ` +
        (copied
          ? 'bg-chip-good-bg border-chip-good-fg/30 text-chip-good-fg'
          : 'bg-lt-card border-lt-hairline text-lt-fg2 hover:bg-lt-inner hover:text-lt-fg') +
        (className ? ` ${className}` : '')
      }
    >
      {copied ? '✓ Copied' : '↗ Copy intake link'}
    </button>
  )
}
