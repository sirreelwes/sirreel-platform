'use client'

/**
 * "Your hours" — one card, both driver pages.
 *
 * A driver on a phone at wrap: pick the day, two clock times, a break, save.
 * One row per day; saving the same day again replaces it. The window is the
 * job's dates padded a day each side, so an evening-before delivery logs
 * cleanly and a typo three weeks out is refused with a plain message.
 *
 * `endpoint` is the route that owns the anchor (sub-rental or our-truck
 * assignment); the body and the response shape are identical.
 */

import { useState } from 'react'

export interface HoursEntry {
  workDate: string
  startTime: string
  endTime: string
  breakMinutes: number
  hours: number
  notes: string | null
}

const fmtDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

export function DriverHoursCard({
  endpoint,
  entries,
  total,
  defaultDate,
  prompt,
  onChange,
  readOnly = false,
}: {
  endpoint: string
  /** HQ preview — nothing posts. */
  readOnly?: boolean
  entries: HoursEntry[]
  total: number
  /** Pre-filled work date (today, clamped to the window by the server). */
  defaultDate: string
  /** True while the page should be nagging — the job is on or just past. */
  prompt: boolean
  onChange: (next: { entries: HoursEntry[]; total: number }) => void
}) {
  const [open, setOpen] = useState(prompt && entries.length === 0)
  const [workDate, setWorkDate] = useState(defaultDate)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [brk, setBrk] = useState('30')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function save() {
    if (readOnly) return
    setBusy(true); setErr(null); setSaved(null)
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workDate, startTime: start, endTime: end, breakMinutes: Number(brk || 0), notes }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save that.')
      onChange(j.hours)
      setSaved(`${fmtDay(workDate)} saved.`)
      setStart(''); setEnd(''); setNotes('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save that.')
    } finally { setBusy(false) }
  }

  async function remove(date: string) {
    if (readOnly) return
    if (!window.confirm(`Remove ${fmtDay(date)}?`)) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workDate: date }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not remove that.')
      onChange(j.hours)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove that.')
    } finally { setBusy(false) }
  }

  const field = 'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-[16px] text-white focus:outline-none focus:border-amber-500'
  const label = 'block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-1'

  return (
    <section className={`mb-4 rounded-2xl border p-4 ${prompt && entries.length === 0 ? 'border-amber-700 bg-amber-950/25' : 'border-zinc-800 bg-zinc-900'}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-400">Your hours</h2>
        {entries.length > 0 && (
          <span className="text-[13px] text-zinc-300">
            <strong className="text-white">{total}</strong> hrs · {entries.length} {entries.length === 1 ? 'day' : 'days'}
          </span>
        )}
      </div>

      {prompt && entries.length === 0 && (
        <p className="mt-2 text-[14px] leading-relaxed text-zinc-200">
          Log your hours at the end of each day you work this job — call to wrap, minus your break.
        </p>
      )}
      {!prompt && entries.length === 0 && (
        <p className="mt-2 text-[13px] text-zinc-400">You&rsquo;ll log your hours here once the job starts.</p>
      )}

      {entries.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-800 rounded-xl border border-zinc-800 overflow-hidden">
          {entries.map((e) => (
            <li key={e.workDate} className="flex items-center justify-between gap-3 px-3 py-2.5 bg-zinc-950/40">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold text-white">{fmtDay(e.workDate)}</div>
                <div className="text-[12px] text-zinc-400">
                  {e.startTime}–{e.endTime}{e.breakMinutes ? ` · ${e.breakMinutes} min break` : ''}{e.notes ? ` · ${e.notes}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[15px] font-bold text-white">{e.hours}h</span>
                <button onClick={() => remove(e.workDate)} disabled={busy} className="text-[12px] text-zinc-500 hover:text-rose-300">Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {err && <p className="mt-3 text-[13px] text-rose-300">{err}</p>}
      {saved && <p className="mt-3 text-[13px] text-emerald-300">{saved}</p>}

      {open ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={label}>Day</label>
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className={field} />
          </div>
          <div>
            <label className={label}>Call (start)</label>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
          </div>
          <div>
            <label className={label}>Wrap (end)</label>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={field} />
          </div>
          <div>
            <label className={label}>Break (min)</label>
            <input type="number" inputMode="numeric" min={0} max={480} step={5} value={brk} onChange={(e) => setBrk(e.target.value)} className={field} />
          </div>
          <div>
            <label className={label}>Note</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className={field} />
          </div>
          <div className="col-span-2 flex items-center gap-3">
            <button
              onClick={save}
              disabled={readOnly || busy || !workDate || !start || !end}
              className="rounded-xl bg-amber-500 px-5 py-3 text-[15px] font-bold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save day'}
            </button>
            {entries.length > 0 && (
              <button onClick={() => setOpen(false)} className="text-[13px] text-zinc-400 hover:text-white">Done</button>
            )}
          </div>
          <p className="col-span-2 text-[12px] text-zinc-500">A wrap time earlier than call means you worked past midnight.</p>
        </div>
      ) : (
        (prompt || entries.length > 0) && (
          <button onClick={() => setOpen(true)} className="mt-3 rounded-xl border border-zinc-700 px-4 py-2.5 text-[14px] font-semibold text-white hover:border-zinc-500">
            {entries.length ? 'Add another day' : 'Log hours'}
          </button>
        )
      )}
    </section>
  )
}
