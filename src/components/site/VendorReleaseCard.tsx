'use client'

/**
 * The partner's acknowledgement that we released their unit
 * (Wes 2026-09-08: "can those emails have a confirm button for the
 * partners to quickly acknowledge release").
 *
 * The release email's button lands here rather than acting on its own. A
 * bare one-click GET in an email gets followed by mail scanners, link
 * previewers and corporate security proxies, so HQ would read
 * "acknowledged" for a partner who never opened it — worse than no signal,
 * because the whole point is knowing who still needs a phone call. So the
 * mail carries a link and the acknowledgement is a button on the page.
 *
 * Nothing here changes the booking: it is already released. This only
 * records that the partner has the dates back, which is what closes the
 * loop on the HQ side.
 */

import { useEffect, useRef, useState } from 'react'

export default function VendorReleaseCard({
  token,
  status,
  releaseAckedAt,
  cancelNotifiedAt,
  readOnly = false,
}: {
  token: string
  status: string
  releaseAckedAt: string | null
  /** When we sent the release notice — shown so the partner can match it
   *  to the email in their inbox. */
  cancelNotifiedAt: string | null
  /** HQ preview — render the card, disable the button. */
  readOnly?: boolean
}) {
  const [ackedAt, setAckedAt] = useState<string | null>(releaseAckedAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrolled = useRef(false)

  // Arriving from the email's button: bring the card into view so the
  // partner isn't hunting for it down a long page on a phone.
  useEffect(() => {
    if (scrolled.current || readOnly || typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).get('ack') !== 'release') return
    scrolled.current = true
    document.getElementById('release-ack')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [readOnly])

  if (status !== 'CANCELLED') return null

  async function ack() {
    if (readOnly) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/public/vendor/${token}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ack-release' }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setError(j.error ?? 'That didn’t go through.'); return }
      setAckedAt(j.releaseAckedAt)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    } finally {
      setBusy(false)
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div id="release-ack" className="mt-6 rounded-[14px] border border-[#e4dfd4] bg-white p-5">
      <div
        className="text-[12px] font-semibold tracking-[0.16em] uppercase text-[#8b857a]"
        style={{ fontFamily: 'Archivo, sans-serif' }}
      >
        The release
      </div>

      {error && (
        <div className="mt-3 text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
          {error}
        </div>
      )}

      {ackedAt ? (
        <p className="mt-2 text-[15px] text-[#2f7d5d] font-semibold">
          Got it — you confirmed the dates are back with you on {fmt(ackedAt)}. Nothing else is
          needed from you.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[14px] text-[#5a554c] leading-relaxed">
            These dates are released and yours to book elsewhere
            {cancelNotifiedAt ? ` — we emailed you on ${fmt(cancelNotifiedAt)}` : ''}. Tap below so
            we know it reached you and nobody has to chase it.
          </p>
          <button
            onClick={ack}
            disabled={busy || readOnly}
            className="mt-4 inline-flex items-center rounded-full bg-amber-600 hover:bg-amber-500 text-white px-5 py-2.5 text-[14px] font-bold disabled:opacity-50"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            {busy ? 'Sending…' : 'Confirm I have the dates back'}
          </button>
        </>
      )}
    </div>
  )
}
