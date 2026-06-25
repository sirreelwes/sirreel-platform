'use client'

import { useState } from 'react'

/**
 * One-click "Copy COI link" — mints a no-login COI upload link
 * (GET /api/coi/link, authed) for the given company/job and copies it to
 * the clipboard. Mirrors CopyIntakeLinkButton's inline-state pattern
 * (no global toast in this app): a transient "Link copied" confirmation,
 * and an inline "Couldn't generate link — retry" on failure — never throws
 * into render. Light variant for the lt-* surfaces (company page); dark
 * variant for the zinc/navy job header.
 */
export function CopyCoiLinkButton({
  companyId,
  jobId,
  variant = 'light',
}: {
  companyId?: string
  jobId?: string
  variant?: 'light' | 'dark'
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [busy, setBusy] = useState(false)

  const onClick = async () => {
    if (busy) return
    setBusy(true)
    setState('idle')
    try {
      const params = new URLSearchParams()
      if (companyId) params.set('companyId', companyId)
      if (jobId) params.set('jobId', jobId)
      const res = await fetch(`/api/coi/link?${params.toString()}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.url) throw new Error(json?.error || `HTTP ${res.status}`)
      try {
        await navigator.clipboard.writeText(json.url)
      } catch {
        // Clipboard blocked (non-https preview, permissions) — fall back
        // to a visible prompt so staff can still copy it manually.
        window.prompt('Copy this COI upload link:', json.url)
      }
      setState('copied')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    } finally {
      setBusy(false)
    }
  }

  const base = 'text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50 whitespace-nowrap'
  const tone =
    variant === 'dark'
      ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700'
      : 'bg-lt-inner hover:bg-lt-hairline text-lt-fg border-lt-hairline'
  const status =
    state === 'copied'
      ? 'text-emerald-500 border-emerald-400'
      : state === 'error'
        ? 'text-rose-500 border-rose-400'
        : ''
  const label =
    state === 'copied' ? 'Link copied ✓' : state === 'error' ? "Couldn't generate — retry" : 'Copy COI link'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title="Generate a no-login link the client can use to upload their COI"
      className={`${base} ${tone} ${status}`}
    >
      {busy ? 'Generating…' : label}
    </button>
  )
}
