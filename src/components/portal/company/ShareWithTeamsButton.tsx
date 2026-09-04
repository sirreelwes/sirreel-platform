'use client'

/**
 * "Send to your teams" — the executive forwards the account overview to
 * their own coordinators.
 *
 * Wes 2026-09-04: "One button would allow them to send this info to their
 * production teams."
 *
 * The modal offers people already on this company's shows as checkboxes
 * and takes typed addresses for everyone else. Suggestions save typing;
 * they are not a restriction — a new PM who isn't in HQ yet is exactly the
 * person this gets sent to.
 *
 * The consequence is stated on the button, not buried: the reader is told
 * how many people are about to receive mail, and that replies come back to
 * them rather than to SirReel.
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Send, X } from 'lucide-react'
import { PORTAL } from '@/lib/brand/portalTokens'

interface Suggestion {
  email: string
  name: string
  role: string | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function ShareWithTeamsButton({
  companyId,
  companyName,
}: {
  companyId: string
  companyName: string
}) {
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [typed, setTyped] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || suggestions) return
    fetch(`/api/portal/company/${companyId}/share`)
      .then((r) => (r.ok ? r.json() : { suggestions: [] }))
      .then((j) => setSuggestions(j.suggestions || []))
      .catch(() => setSuggestions([]))
  }, [open, suggestions, companyId])

  /** Typed addresses, split on commas / whitespace / newlines. */
  const typedEmails = typed
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => EMAIL_RE.test(s))

  const allEmails = [...new Set([...picked, ...typedEmails])]
  const typedButInvalid =
    typed.trim().length > 0 && typedEmails.length === 0 ? typed.trim() : null

  const toggle = useCallback((email: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      return next
    })
  }, [])

  async function send() {
    if (allEmails.length === 0) return
    setSending(true)
    setError(null)
    setResult(null)
    try {
      const byEmail = new Map((suggestions || []).map((s) => [s.email, s.name]))
      const res = await fetch(`/api/portal/company/${companyId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: allEmails.map((e) => ({ email: e, name: byEmail.get(e) || null })),
          message: message.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Send failed')
      setResult(json.message || 'Sent.')
      setPicked(new Set())
      setTyped('')
      setMessage('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white"
        style={{ backgroundColor: PORTAL.dark }}
      >
        <Send className="w-3.5 h-3.5" /> Send to your teams
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-zinc-100">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-zinc-900">Send to your teams</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              A short email covering how the {companyName} account works with SirReel and what we
              can do. No rates or invoice figures are included.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-zinc-400 hover:text-zinc-900 shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {suggestions === null ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your contacts…
            </div>
          ) : suggestions.length > 0 ? (
            <div>
              <div className="text-[11px] uppercase font-semibold tracking-wider text-zinc-400 mb-2">
                People on your shows
              </div>
              <div className="border border-zinc-200 rounded-lg divide-y divide-zinc-100 max-h-52 overflow-y-auto">
                {suggestions.map((s) => (
                  <label
                    key={s.email}
                    className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-zinc-50"
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-zinc-900 shrink-0"
                      checked={picked.has(s.email)}
                      onChange={() => toggle(s.email)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-zinc-900 truncate">{s.name}</span>
                      <span className="block text-xs text-zinc-500 truncate">
                        {s.email}
                        {s.role ? ` · ${s.role}` : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <label className="block text-[11px] uppercase font-semibold tracking-wider text-zinc-400 mb-1.5">
              Other addresses
            </label>
            <textarea
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              rows={2}
              placeholder="name@production.com, another@production.com"
              className="w-full text-sm border border-zinc-300 rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-900"
            />
            {typedButInvalid && (
              <p className="text-xs text-amber-800 mt-1">
                Nothing in there looks like an email address yet.
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] uppercase font-semibold tracking-wider text-zinc-400 mb-1.5">
              Add a note (optional)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, 1200))}
              rows={3}
              placeholder="Use SirReel for all vehicle and supply orders this season — Dana"
              className="w-full text-sm border border-zinc-300 rounded-lg px-3 py-2 focus:outline-none focus:border-zinc-900"
            />
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}
          {result && (
            <p className="text-sm text-emerald-700 inline-flex items-center gap-1.5">
              <Check className="w-4 h-4" /> {result}
            </p>
          )}
        </div>

        <div className="p-5 border-t border-zinc-100 flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-500 min-w-0">
            {allEmails.length === 0
              ? 'Pick or type at least one address.'
              : `${allEmails.length} recipient${allEmails.length === 1 ? '' : 's'} · replies come to you`}
          </p>
          <button
            type="button"
            onClick={send}
            disabled={sending || allEmails.length === 0}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-40 shrink-0"
            style={{ backgroundColor: PORTAL.dark }}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
