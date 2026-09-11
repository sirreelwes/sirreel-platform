'use client'

/**
 * Review-and-send for the company-portal invite.
 *
 * Wes 2026-09-11: "next time I'd like to be able to preview and modify the
 * invite email to Nancy and people like her." Before this, "Send invite"
 * on the access panel sent the templated mail sight unseen.
 *
 * The left column is the prose the rep may edit — seeded with the exact
 * templated copy (defaultBody), so an edit starts from real words. The
 * right column is the rendered email, re-fetched from the same composer
 * the send uses, so what is shown is what goes. The shell around the
 * prose — the annual-agreement callout, the portal button, the sign-off —
 * is not editable here: those are facts about the account.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, Send, X } from 'lucide-react'
import { EmailBody } from '@/components/email/EmailBody'

interface Composition {
  ok: true
  to: { email: string; name: string }
  subject: string
  html: string
  text: string
  defaultBody: string
  replyTo: string | null
  repName: string
  companyName: string
  alreadyInvitedAt: string | null
}

export function CompanyInviteReviewModal({
  companyId,
  accessId,
  onClose,
  onSent,
}: {
  companyId: string
  accessId: string
  onClose: () => void
  onSent: (info: { email: string }) => void
}) {
  const [comp, setComp] = useState<Composition | null>(null)
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const previewUrl = `/api/crm/companies/${companyId}/portal-access/${accessId}/invite/preview`

  async function fetchPreview(customBody: string | null) {
    const res = await fetch(previewUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customBody }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json?.error || 'Could not build the preview.')
    return json as Composition
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const c = await fetchPreview(null)
        if (cancelled) return
        setComp(c)
        if (!seeded.current) {
          setBody(c.defaultBody)
          seeded.current = true
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not build the preview.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, accessId])

  // Re-render the email as the rep types — from the server, never a client
  // approximation, so the preview is the send.
  useEffect(() => {
    if (!seeded.current || !comp) return
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setRefreshing(true)
      try {
        const c = await fetchPreview(body.trim() && body.trim() !== comp.defaultBody.trim() ? body : null)
        setComp((cur) => (cur ? { ...cur, html: c.html, text: c.text, subject: c.subject } : c))
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not refresh the preview.')
      } finally {
        setRefreshing(false)
      }
    }, 500)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body])

  const edited = !!comp && body.trim() !== comp.defaultBody.trim()

  async function send() {
    if (!comp) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/portal-access/${accessId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendInvite: true, customBody: edited ? body : null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Send failed')
      onSent({ email: comp.to.email })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-lt-card rounded-2xl border border-lt-hairline w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-lt-hairline flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-lt-fg3 font-semibold">Account portal invite</div>
            <div className="text-sm font-semibold text-lt-fg mt-0.5 truncate">
              {comp ? `To ${comp.to.name} · ${comp.to.email}` : 'Loading…'}
            </div>
            {comp && (
              <div className="text-xs text-lt-fg2 mt-0.5 truncate">
                Subject: {comp.subject}
                {comp.replyTo ? ` · replies go to ${comp.replyTo}` : ''}
                {comp.alreadyInvitedAt
                  ? ` · already invited ${new Date(comp.alreadyInvitedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — this re-sends`
                  : ''}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-lt-fg3 hover:text-lt-fg" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-sm text-lt-fg2 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Building the email…
          </div>
        ) : !comp ? (
          <div className="p-8 text-sm text-chip-bad-fg">{error || 'Could not build the preview.'}</div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="p-5 border-b lg:border-b-0 lg:border-r border-lt-hairline flex flex-col min-h-0">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <label className="text-[11px] uppercase tracking-widest text-lt-fg3 font-semibold">The message</label>
                {edited && (
                  <button
                    type="button"
                    onClick={() => setBody(comp.defaultBody)}
                    className="text-[11px] text-lt-fg2 hover:text-lt-fg underline"
                  >
                    Back to the standard wording
                  </button>
                )}
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="flex-1 min-h-[280px] w-full border border-lt-hairline rounded-lg px-3 py-2 text-sm text-lt-fg bg-lt-inner leading-relaxed resize-none focus:outline-none focus:border-zinc-500"
                spellCheck
              />
              <p className="text-[11px] text-lt-fg3 mt-2 leading-relaxed">
                Edit the words above. The portal button, the annual-agreement note and the sign-off stay
                as they are — they are read from the account, not typed here.
              </p>
            </div>
            <div className="p-5 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-widest text-lt-fg3 font-semibold">What they receive</div>
                {refreshing && <Loader2 className="w-3.5 h-3.5 animate-spin text-lt-fg3" />}
              </div>
              <div className="flex-1 min-h-0 border border-lt-hairline rounded-lg overflow-hidden bg-white">
                <EmailBody bodyText={comp.text} bodyHtml={comp.html} height={520} iframeLabel="Invite preview" />
              </div>
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-lt-hairline flex items-center justify-between gap-3">
          <div className="text-xs text-chip-bad-fg">{!loading && comp && error ? error : ''}</div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="text-xs text-lt-fg2 hover:text-lt-fg px-3 py-2">
              Cancel
            </button>
            <button
              type="button"
              onClick={send}
              disabled={!comp || sending || refreshing}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {comp?.alreadyInvitedAt ? 'Re-send invite' : 'Send invite'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
