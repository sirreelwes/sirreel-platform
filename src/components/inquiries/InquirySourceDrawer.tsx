'use client'

/**
 * InquirySourceDrawer — read-only slide-over showing the email an Inquiry
 * came from.
 *
 * The new-quote page's "View original →" used to be an <a href> to
 * /inquiries/[id]. On the Review step that navigates away mid-edit: every
 * un-saved line-item rate, department, contact selection and job pick is
 * gone on the way back. The original message is reference material, not a
 * destination — so it opens here instead, over the form, and closes back
 * onto the same state.
 *
 * Deliberately read-only: no capture / dismiss / attach-to-job. Triage
 * actions live on the ThreadDrawer and the inquiry page (still reachable
 * from the header link, which opens in a NEW TAB for the same reason).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { EmailBody } from '@/components/email/EmailBody'

interface DrawerMessage {
  id: string
  fromAddress: string
  toAddresses: string[]
  subject: string
  snippet: string | null
  bodyText: string | null
  bodyHtml: string | null
  attachmentCount: number
  direction: string
  sentAt: string
}

interface DrawerResponse {
  inquiry: { id: string; title: string; description: string; source: string; createdAt: string }
  thread: { id: string; subject: string | null } | null
  anchorMessageId: string | null
  messages: DrawerMessage[]
}

function fmtWhen(iso: string) {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

function parseDisplay(fromHeader: string): string {
  const named = fromHeader.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>/)
  if (named) return named[1].trim()
  const angle = fromHeader.match(/<([^>]+)>/)
  return (angle ? angle[1] : fromHeader).trim()
}

export function InquirySourceDrawer({
  inquiryId,
  title,
  onClose,
}: {
  /** Null closes the drawer — same open-key convention as ThreadDrawer. */
  inquiryId: string | null
  title?: string | null
  onClose: () => void
}) {
  const [data, setData] = useState<DrawerResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!inquiryId) {
      setData(null)
      setError('')
      return
    }
    let active = true
    setLoading(true)
    setData(null)
    setError('')
    fetch(`/api/inquiries/${encodeURIComponent(inquiryId)}/thread`)
      .then((r) => r.json())
      .then((d: DrawerResponse & { error?: string }) => {
        if (!active) return
        if (d.error) setError(d.error)
        else setData(d)
      })
      .catch(() => { if (active) setError('Could not load the original message.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [inquiryId])

  // Esc closes. Stops propagation is not needed — the page has no other
  // Escape handler on the review step.
  useEffect(() => {
    if (!inquiryId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inquiryId, onClose])

  // Focus trap — the form behind is a long tab order; without this, Tab
  // walks straight out of the drawer into the line-item inputs.
  useEffect(() => {
    if (!inquiryId) return
    closeBtnRef.current?.focus()
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const root = drawerRef.current
      if (!root) return
      const enabled = Array.from(
        root.querySelectorAll<HTMLElement>('a, button, input, textarea, select, [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => !el.hasAttribute('disabled'))
      if (enabled.length === 0) return
      const first = enabled[0]
      const last = enabled[enabled.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onTab)
    return () => window.removeEventListener('keydown', onTab)
  }, [inquiryId])

  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  if (!inquiryId) return null

  const messages = data?.messages ?? []
  const heading = data?.thread?.subject || messages[0]?.subject || data?.inquiry.title || title || 'Original inquiry'

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inquiry-source-drawer-title"
        onClick={stop}
        className="fixed right-0 top-0 h-full z-50 w-full sm:w-[600px] max-w-[100vw] bg-white shadow-2xl flex flex-col"
      >
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div className="min-w-0 flex-1 pr-3">
            <div className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Original inquiry</div>
            <div id="inquiry-source-drawer-title" className="text-[15px] font-extrabold text-gray-900 truncate mt-0.5">
              {heading}
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {loading
                ? 'Loading…'
                : messages.length > 0
                ? `${messages.length} message${messages.length === 1 ? '' : 's'} on this thread`
                : 'No email stored — showing the inquiry as captured'}
              {' · '}
              <a
                href={`/inquiries/${inquiryId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-500 hover:text-gray-800 underline underline-offset-2"
              >
                Open full inquiry ↗
              </a>
            </p>
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close original inquiry"
            className="text-gray-400 hover:text-gray-700 text-xl p-1 flex-shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mb-3" />
              <span className="text-[12px]">Loading original…</span>
            </div>
          )}

          {!loading && error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-600">{error}</div>
          )}

          {!loading && !error && messages.map((m) => {
            const inbound = m.direction.toLowerCase() === 'inbound'
            return (
              <div
                key={m.id}
                className={`rounded-lg border p-3 ${inbound ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-gray-900 truncate">
                      {parseDisplay(m.fromAddress)}
                      <span className={`ml-2 text-[9px] font-bold uppercase tracking-widest ${inbound ? 'text-emerald-600' : 'text-gray-400'}`}>
                        {inbound ? 'in' : 'out'}
                      </span>
                    </div>
                    {m.toAddresses.length > 0 && (
                      <div className="text-[10px] text-gray-400 truncate">to {m.toAddresses.join(', ')}</div>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-400 whitespace-nowrap">{fmtWhen(m.sentAt)}</div>
                </div>
                {m.attachmentCount > 0 && (
                  <div className="text-[10px] text-gray-500 mt-1">
                    📎 {m.attachmentCount} attachment{m.attachmentCount === 1 ? '' : 's'}
                  </div>
                )}
                <div className="mt-2">
                  <EmailBody
                    bodyText={m.bodyText}
                    bodyHtml={m.bodyHtml}
                    snippet={m.snippet}
                    height={360}
                    iframeLabel={`Message from ${parseDisplay(m.fromAddress)}`}
                  />
                </div>
              </div>
            )
          })}

          {/* No stored email (WEB_FORM / MANUAL, or a Gmail row whose body
              never synced) — the inquiry's own description is the record. */}
          {!loading && !error && messages.length === 0 && data && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                {data.inquiry.source === 'WEB_FORM' ? 'Web form submission' : 'As captured'}
                {' · '}{fmtWhen(data.inquiry.createdAt)}
              </div>
              <pre className="whitespace-pre-wrap font-mono text-[11.5px] text-gray-700 leading-relaxed">
                {data.inquiry.description || 'No detail was captured with this inquiry.'}
              </pre>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
