'use client'

/**
 * "Sign once for the year" — the account portal's ask, made clickable.
 *
 * The terms block has always told accounts that sign per show to "ask your
 * rep about an annual agreement". That sentence was the whole mechanism:
 * the client had to leave the portal, remember who their rep was, and write
 * an email, and HQ heard about it only if they did. The button records the
 * ask against the account, where it becomes an action item for the desk.
 *
 * It asks — it does not sign and does not commit anyone. Staff answer it by
 * filing the annual for signature; an executive signs THAT, in this same
 * portal.
 *
 * Disabled in the staff preview, where there is no client session and a
 * write would file a request nobody made.
 */

import { useState } from 'react'
import { Check, Loader2, Send } from 'lucide-react'

export function AskForAnnualButton({
  companyId,
  requestedAt,
  preview,
}: {
  companyId: string
  /** An ask already on file for this account, ISO — renders the done state. */
  requestedAt: string | null
  preview: boolean
}) {
  const [asked, setAsked] = useState(!!requestedAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ask() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/portal/company/${companyId}/annual-request`, { method: 'POST' })
      if (!res.ok) throw new Error('failed')
      setAsked(true)
    } catch {
      setError('Could not send that — please email your rep.')
    } finally {
      setBusy(false)
    }
  }

  if (asked) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
        <Check className="w-3.5 h-3.5" /> Requested — your rep will follow up
      </p>
    )
  }

  return (
    <div className="mt-2">
      <button
        onClick={ask}
        disabled={busy || preview}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-900 hover:text-black disabled:opacity-50"
        title={preview ? 'Disabled in preview' : 'Ask SirReel to set up an annual agreement'}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        Ask about an annual agreement
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}
