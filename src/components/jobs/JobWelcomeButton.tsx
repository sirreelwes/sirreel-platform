'use client'

/**
 * "Send welcome email" — the client's hello + their no-login link to this
 * job (Wes 2026-09-11: "remind us to send the welcome email" once a quote
 * has gone out).
 *
 * Reads GET /api/jobs/[id]/welcome (the same rule the /jobs tile reads —
 * lib/jobs/welcomeReminder) and shows one of:
 *   due   — filled turquoise button + "not sent yet": a quote is out and
 *           nobody has welcomed the client. This is the reminder.
 *   sent  — outline button reading when and to whom; a click re-sends.
 *   none  — outline button, no nag (nothing quoted yet, or long ago).
 * No client job page yet (no order with a portal) → disabled, and the
 * title says to send the quote first: the welcome IS the link.
 *
 * The send goes through EmailReviewModal like every other client email —
 * preview, edit, then a separate Send. Owns its modal so the /jobs tile
 * could host it later without re-plumbing the page's.
 */

import { useCallback, useEffect, useState } from 'react'
import { Mail } from 'lucide-react'
import { EmailReviewModal } from '@/components/email/EmailReviewModal'

interface WelcomeStatus {
  state: 'due' | 'sent' | 'none'
  quotedAt: string | null
  sentAt: string | null
  sentTo: string | null
  to: { id: string; name: string; email: string } | null
  hasPortal: boolean
}

function relative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const d = Math.floor(ms / 86_400_000)
  if (d <= 0) {
    const h = Math.floor(ms / 3_600_000)
    return h <= 0 ? 'just now' : `${h}h ago`
  }
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function JobWelcomeButton({ jobId, onSent }: { jobId: string; onSent?: () => void }) {
  const [status, setStatus] = useState<WelcomeStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/jobs/${jobId}/welcome`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok) setStatus(d as WelcomeStatus)
      })
      .catch(() => {})
  }, [jobId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  if (!status) return null

  const first = status.to?.name.split(' ')[0] || ''
  const canSend = status.hasPortal && !!status.to
  const title = !status.to
    ? 'Add a contact with an email to this job first'
    : !status.hasPortal
      ? 'Send the quote first — the welcome is the link to the client’s job page, which the quote creates'
      : status.state === 'sent'
        ? `Welcome sent ${status.sentAt ? relative(status.sentAt) : ''}${status.sentTo ? ` to ${status.sentTo}` : ''}. Previews a fresh one to ${status.to!.email}; nothing sends until you press Send.`
        : `Previews the welcome to ${status.to!.email} — hello, and their no-login link to this job. Nothing sends until you press Send.`

  const due = status.state === 'due' && canSend
  const cls = due
    ? 'bg-amber-600 hover:bg-amber-500 text-white'
    : 'bg-white border border-zinc-200 hover:border-amber-400 text-amber-700 hover:text-amber-600'

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setOpen(true)}
        disabled={!canSend}
        title={title}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
      >
        <Mail size={13} aria-hidden />
        {status.state === 'sent'
          ? `Welcome sent${status.sentAt ? ` ${relative(status.sentAt)}` : ''} · send again`
          : first
            ? `Send welcome email → ${first}`
            : 'Send welcome email'}
      </button>
      {due && (
        <span className="text-[11px] font-semibold text-amber-800">
          not sent yet
          {status.quotedAt ? ` · quoted ${relative(status.quotedAt)}` : ''}
        </span>
      )}
      {toast && <span className="text-[11px] text-emerald-700 font-semibold">{toast}</span>}

      <EmailReviewModal
        target={open ? { kind: 'job-welcome', jobId } : null}
        onClose={() => setOpen(false)}
        onSent={(info) => {
          setOpen(false)
          setToast(`Welcome sent to ${info.recipient}`)
          load()
          onSent?.()
        }}
      />
    </div>
  )
}
