'use client'

/**
 * "Need to change these dates?" — the client's way to ask, on the Schedule
 * card of their job portal.
 *
 * Wes 2026-09-18, on the L'anza job: "client said they wanted to change the
 * pickup date but couldn't figure out how to do that." They couldn't. The
 * card printed Pickup and Return and offered nothing beside them, and the
 * one line on the page that mentioned a change ("Need these dates held
 * sooner, or something changed?") lives inside the not-booked-yet notice,
 * which disappears the moment the order is quoted — so the further along a
 * job got, the less the portal said about how to move it.
 *
 * WHAT THIS IS NOT: a reschedule. Nothing here books anything, checks
 * availability or quotes a price. Those are the cascade a rep reads in
 * "Change dates…" before applying, and a form that told a client "the 16th
 * is free" would be wrong by the time they read it. So the copy promises a
 * person, not a date — and says out loud that the dates have NOT changed
 * yet, which is the sentence that keeps a production from planning around
 * an unconfirmed move.
 */

import { useState } from 'react'

interface OpenRequest {
  requestedAt: string
  requestedStartDate: string | null
  requestedEndDate: string | null
  note: string | null
  requestedByName: string | null
}

/** A date-only ISO value as the YYYY-MM-DD an <input type="date"> wants.
 *  Read in UTC — these are @db.Date columns serialized at midnight UTC, and
 *  reading them locally shows the previous day anywhere west of UTC (the
 *  same bug fmtDate on the portal page carries a comment about). */
function toInputDay(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : ''
}

function prettyDay(day: string | null): string {
  if (!day) return '—'
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function DateChangeRequestCard({
  currentStart,
  currentEnd,
  canRequest,
  openRequest,
  repName,
  repPhone,
  onSubmitted,
}: {
  /** The order's dates, as the page already has them (ISO, date-only). */
  currentStart: string | null
  currentEnd: string | null
  /** False on a closed or cancelled order — there is nothing left to move. */
  canRequest: boolean
  /** The ask already with their rep, if any. */
  openRequest: OpenRequest | null
  repName: string | null
  repPhone: string | null
  /** Re-read the portal data so the card picks up the filed request. */
  onSubmitted: () => void
}) {
  // `editing` wins over a filed request — it is how "Send a different
  // date" gets back to the form once one is already on file.
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [start, setStart] = useState(toInputDay(currentStart))
  const [end, setEnd] = useState(toInputDay(currentEnd))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [justSent, setJustSent] = useState(false)

  if (!canRequest) return null

  // Their ask, as the server now has it. `justSent` covers the moment
  // between sending and the refreshed payload arriving.
  const filed = openRequest

  // ── Already asked ──────────────────────────────────────────────────
  // Their rep has it. Say what was asked for, so a second person on the
  // job reads the state of play rather than filing the same thing again —
  // and still leave the door open, because changing your mind is the
  // commonest reason to come back here (the route supersedes it).
  if ((filed || justSent) && !editing) {
    const req = filed
    return (
      <div className="border-t border-zinc-100 pt-3">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
          <div className="text-[10px] uppercase tracking-widest font-semibold text-emerald-800">
            Date change requested
          </div>
          <p className="text-sm text-zinc-800 mt-1 leading-relaxed">
            {repName ? `${repName.split(' ')[0]} has this` : 'Your rep has this'} and will confirm what
            we can do.{' '}
            <strong>The dates above have not changed yet</strong> — they update here once it is
            confirmed.
          </p>
          {req && (req.requestedStartDate || req.requestedEndDate) && (
            <p className="text-xs text-zinc-600 mt-2">
              You asked for{' '}
              {req.requestedStartDate && <>pickup <strong>{prettyDay(req.requestedStartDate)}</strong></>}
              {req.requestedStartDate && req.requestedEndDate && ', '}
              {req.requestedEndDate && <>return <strong>{prettyDay(req.requestedEndDate)}</strong></>}.
            </p>
          )}
          {req?.note && (
            <p className="text-xs text-zinc-600 mt-1 italic">&ldquo;{req.note}&rdquo;</p>
          )}
          <p className="text-[11px] text-zinc-500 mt-2">
            Need it sooner, or changed your mind?{' '}
            {repPhone ? (
              <a href={`tel:${repPhone}`} className="font-semibold text-zinc-700 hover:text-zinc-900 underline">
                Call {repName ? repName.split(' ')[0] : 'us'} at {repPhone}
              </a>
            ) : (
              <a href="tel:8884777335" className="font-semibold text-zinc-700 hover:text-zinc-900 underline">
                Call us at (888) 477-7335
              </a>
            )}
            {'. '}
            <button
              type="button"
              onClick={() => {
                setEditing(true)
                setOpen(true)
                setNote('')
                setError('')
              }}
              className="font-semibold text-zinc-700 hover:text-zinc-900 underline"
            >
              Send a different date
            </button>
          </p>
        </div>
      </div>
    )
  }

  // ── The prompt ─────────────────────────────────────────────────────
  if (!open) {
    return (
      <div className="border-t border-zinc-100 pt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-semibold text-zinc-700 hover:text-zinc-900 underline"
        >
          Need to change these dates?
        </button>
      </div>
    )
  }

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/portal/job/dates/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: start || null,
          endDate: end || null,
          note,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          json?.error ||
            'Could not send that. Please call your rep and they will move it for you.',
        )
        return
      }
      setJustSent(true)
      setOpen(false)
      setEditing(false)
      onSubmitted()
    } catch {
      setError('Could not send that. Please call your rep and they will move it for you.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t border-zinc-100 pt-3">
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <div className="text-[10px] uppercase tracking-widest font-semibold text-zinc-500">
          Change these dates
        </div>
        <p className="text-xs text-zinc-600 mt-1 leading-relaxed">
          Tell us what you need and {repName ? repName.split(' ')[0] : 'your rep'} will confirm what
          we can do. Nothing changes until they do — this does not move the booking by itself.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              New pickup
            </span>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              // 16px so iOS Safari does not zoom the page on focus.
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[16px] text-zinc-900"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              New return
            </span>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[16px] text-zinc-900"
            />
          </label>
        </div>

        <label className="block mt-3">
          <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
            Anything we should know? <span className="normal-case tracking-normal">(optional)</span>
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Our location moved to Thursday, so we need the truck a day earlier."
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[16px] text-zinc-900 placeholder:text-zinc-400"
          />
        </label>

        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-400 text-white text-xs font-semibold rounded-lg transition"
          >
            {saving ? 'Sending…' : 'Send to my rep'}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setEditing(false)
              setError('')
              setStart(toInputDay(currentStart))
              setEnd(toInputDay(currentEnd))
              setNote('')
            }}
            disabled={saving}
            className="px-4 py-2 border border-zinc-300 hover:border-zinc-400 disabled:opacity-50 text-zinc-700 text-xs font-semibold rounded-lg bg-white"
          >
            Cancel
          </button>
          {repPhone && (
            <a
              href={`tel:${repPhone}`}
              className="text-[11px] text-zinc-500 hover:text-zinc-700 underline"
            >
              or call {repName ? repName.split(' ')[0] : 'us'} at {repPhone}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
