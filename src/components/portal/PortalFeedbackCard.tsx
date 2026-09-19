'use client'

/**
 * "How are you finding this?" — the client's rating, with a quiet way to
 * say more.
 *
 * Wes 2026-09-19: "put a quick star ranking system for how they like this
 * platform", then: "lead with the rating system, and then to the right of
 * it, have a very small thing that says 'Suggest an improvement.'"
 *
 * So the stars ARE the ask. One tap, saved immediately, no Send button and
 * no dialog — a rating that costs a second gets given, and a rating behind
 * a form does not. "Suggest an improvement" sits to the right, deliberately
 * small: it is there for the person who wants it, and invisible to the
 * person who just wants to tap four stars and get on with their shoot.
 *
 * What a client never sees back: severity, category, whether it reached
 * Wes, or that anything read it at all. Just thanks. The triage happens on
 * our side and stays there.
 *
 * Every hook is above every early return (no ESLint in this repo —
 * project_no_eslint_hooks_gap).
 */

import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'

export function PortalFeedbackCard() {
  const [stars, setStars] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)
  const [openBox, setOpenBox] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [thanks, setThanks] = useState<string | null>(null)

  // Their standing rating, so the stars come back filled in next visit.
  useEffect(() => {
    let cancelled = false
    fetch('/api/portal/job/feedback')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && typeof d.stars === 'number') setStars(d.stars) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  async function rate(n: number) {
    setStars(n)
    setSaved(false)
    try {
      const res = await fetch('/api/portal/job/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars: n }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } catch {
      // A rating that fails to save is not worth an error message at a
      // client mid-shoot; the stars stay where they tapped them.
    }
  }

  async function sendSuggestion() {
    if (text.trim().length < 8 || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/portal/job/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text.trim(), pagePath: window.location.pathname }),
      })
      const data = await res.json()
      setThanks(res.ok ? data.message : 'Could not send that just now — please tell your rep.')
      if (res.ok) { setText(''); setOpenBox(false) }
    } catch {
      setThanks('Could not send that just now — please tell your rep.')
    } finally {
      setSending(false)
    }
  }

  const shown = hover ?? stars ?? 0

  return (
    <div className="rounded-xl border border-[#e2ddd0] bg-white p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* The rating leads. */}
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-semibold text-[#1b1a17]">How are you finding this?</span>
          <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(null)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => rate(n)}
                onMouseEnter={() => setHover(n)}
                aria-label={`${n} star${n === 1 ? '' : 's'}`}
                className="p-0.5 transition-transform hover:scale-110"
              >
                <Star
                  className={`w-6 h-6 ${
                    n <= shown ? 'fill-[#0F7A93] text-[#0F7A93]' : 'text-[#c9c3b5]'
                  }`}
                />
              </button>
            ))}
          </div>
          {saved && <span className="text-[13px] text-[#0F7A93]">Thank you</span>}
        </div>

        <div className="flex-1" />

        {/* Deliberately small, and to the right. */}
        {!openBox && (
          <button
            type="button"
            onClick={() => setOpenBox(true)}
            className="text-[13px] text-[#6b665c] underline underline-offset-2 hover:text-[#0F7A93]"
          >
            Suggest an improvement
          </button>
        )}
      </div>

      {openBox && (
        <div className="mt-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={6000}
            disabled={sending}
            autoFocus
            placeholder="Anything at all — something that didn't work, a page that reads oddly, something you wish it did."
            className="w-full rounded-lg border border-[#e2ddd0] bg-[#faf9f6] px-3.5 py-3 text-[15px] text-[#1b1a17] placeholder:text-[#9a9488] leading-relaxed resize-y focus:outline-none focus:border-[#0F7A93] disabled:opacity-60"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={sendSuggestion}
              disabled={text.trim().length < 8 || sending}
              className="rounded-lg bg-[#0F7A93] hover:bg-[#0C657A] disabled:bg-[#e2ddd0] disabled:text-[#9a9488] px-4 py-2 text-sm font-semibold text-white transition-colors"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
            <button
              type="button"
              onClick={() => { setOpenBox(false); setText('') }}
              className="text-[13px] text-[#6b665c] hover:text-[#1b1a17]"
            >
              Never mind
            </button>
          </div>
        </div>
      )}

      {thanks && <p className="mt-3 text-[14px] text-[#3f3b33]">{thanks}</p>}
    </div>
  )
}
