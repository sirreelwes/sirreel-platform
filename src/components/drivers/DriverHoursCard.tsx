'use client'

/**
 * "Your hours" — portal to portal, one card, both driver pages.
 *
 * Wes 2026-09-05: drivers log LEFT LOT → ON SET (the production's call) →
 * LEFT SET → WRAP (vehicle cleaned, dumped, fuelled, parked). A driver taps
 * "Now" on each as the day happens; the day stays open until Wrap, then the
 * total appears. Picking a day that already has stamps loads them, so the
 * 5am "left lot" and the 9pm "wrap" are one row.
 *
 * `endpoint` owns the anchor (sub-rental or our-truck assignment); the body
 * and the response shape are identical.
 */

import { useEffect, useState } from 'react'

export interface HoursEntry {
  workDate: string
  startTime: string
  onSetTime: string | null
  leftSetTime: string | null
  endTime: string | null
  hours: number | null
  notes: string | null
}

const fmtDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

const nowClock = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const STAMPS: Array<{ key: 'leftLot' | 'onSet' | 'leftSet' | 'wrap'; label: string; hint: string }> = [
  { key: 'leftLot', label: 'Left lot', hint: 'Pulled out of the yard' },
  { key: 'onSet', label: 'On set', hint: 'Arrived — the production’s call time' },
  { key: 'leftSet', label: 'Left set', hint: 'Rolled off location' },
  { key: 'wrap', label: 'Wrap', hint: 'Cleaned, dumped, fuelled, parked' },
]

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
  entries: HoursEntry[]
  total: number
  defaultDate: string
  prompt: boolean
  onChange: (next: { entries: HoursEntry[]; total: number; open?: number }) => void
  readOnly?: boolean
}) {
  const openDay = entries.find((e) => e.hours === null)
  const [open, setOpen] = useState((prompt && entries.length === 0) || !!openDay)
  const [workDate, setWorkDate] = useState(openDay?.workDate ?? defaultDate)
  const [stamps, setStamps] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  // Resume: picking a day that already has stamps loads them into the form.
  useEffect(() => {
    const e = entries.find((x) => x.workDate === workDate)
    setStamps(e ? { leftLot: e.startTime, onSet: e.onSetTime ?? '', leftSet: e.leftSetTime ?? '', wrap: e.endTime ?? '' } : {})
    setNotes(e?.notes ?? '')
  }, [workDate, entries])

  async function save() {
    if (readOnly) return
    setBusy(true); setErr(null); setSaved(null)
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workDate, leftLot: stamps.leftLot ?? '', onSet: stamps.onSet ?? '', leftSet: stamps.leftSet ?? '', wrap: stamps.wrap ?? '', notes }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save that.')
      onChange(j.hours)
      setSaved(stamps.wrap ? `${fmtDay(workDate)} wrapped and saved.` : `${fmtDay(workDate)} saved — come back and add the rest as the day goes.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save that.')
    } finally { setBusy(false) }
  }

  async function remove(date: string) {
    if (readOnly) return
    if (!window.confirm(`Remove ${fmtDay(date)}?`)) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch(endpoint, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workDate: date }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not remove that.')
      onChange(j.hours)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove that.')
    } finally { setBusy(false) }
  }

  const field = 'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-[16px] text-white focus:outline-none focus:border-amber-500'
  const label = 'block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-1'
  const warn = prompt && (entries.length === 0 || !!openDay)

  return (
    <section className={`mb-4 rounded-2xl border p-4 ${warn ? 'border-amber-700 bg-amber-950/25' : 'border-zinc-800 bg-zinc-900'}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-400">Your hours</h2>
        {entries.length > 0 && (
          <span className="text-[13px] text-zinc-300">
            <strong className="text-white">{total}</strong> hrs · {entries.length} {entries.length === 1 ? 'day' : 'days'}{openDay ? ' · 1 open' : ''}
          </span>
        )}
      </div>

      {prompt && entries.length === 0 && (
        <p className="mt-2 text-[14px] leading-relaxed text-zinc-200">
          Log the day portal to portal: tap <strong>Now</strong> when you leave the lot, arrive on set, leave set, and wrap. Save any time — come back to finish.
        </p>
      )}
      {!prompt && entries.length === 0 && (
        <p className="mt-2 text-[13px] text-zinc-400">You&rsquo;ll log your hours here once the job starts.</p>
      )}

      {entries.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-800 rounded-xl border border-zinc-800 overflow-hidden">
          {entries.map((e) => (
            <li key={e.workDate} className="px-3 py-2.5 bg-zinc-950/40">
              <div className="flex items-center justify-between gap-3">
                <button onClick={() => { setWorkDate(e.workDate); setOpen(true) }} className="min-h-[44px] text-left text-[14px] font-semibold text-white">
                  {fmtDay(e.workDate)}
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[15px] font-bold ${e.hours === null ? 'text-amber-300' : 'text-white'}`}>{e.hours === null ? 'open' : `${e.hours}h`}</span>
                  {!readOnly && (
                    <button onClick={() => remove(e.workDate)} disabled={busy} className="min-h-[44px] min-w-[44px] px-2 text-[13px] text-zinc-500 hover:text-rose-300 active:text-rose-300">
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className="text-[12px] text-zinc-400">
                Lot {e.startTime}{e.onSetTime ? ` → set ${e.onSetTime}` : ''}{e.leftSetTime ? ` → left ${e.leftSetTime}` : ''}{e.endTime ? ` → wrap ${e.endTime}` : ' → wrap —'}{e.notes ? ` · ${e.notes}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}

      {err && <p className="mt-3 text-[13px] text-rose-300">{err}</p>}
      {saved && <p className="mt-3 text-[13px] text-emerald-300">{saved}</p>}

      {open ? (
        <div className="mt-3 space-y-3">
          <div>
            <label className={label}>Day</label>
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className={field} />
          </div>
          {STAMPS.map((s, i) => {
            const prevMissing = i > 0 && !stamps[STAMPS[i - 1].key]
            return (
              <div key={s.key} className="grid grid-cols-[1fr_auto] gap-2 items-end">
                <div>
                  <label className={label}>{s.label} <span className="normal-case tracking-normal font-normal text-zinc-600">— {s.hint}</span></label>
                  <input type="time" value={stamps[s.key] ?? ''} onChange={(e) => setStamps((m) => ({ ...m, [s.key]: e.target.value }))} className={field} disabled={readOnly} />
                </div>
                <button
                  type="button"
                  onClick={() => setStamps((m) => ({ ...m, [s.key]: nowClock() }))}
                  disabled={readOnly || (prevMissing && i > 0)}
                  className="min-h-[46px] rounded-lg border border-amber-700 bg-amber-950/40 px-4 text-[14px] font-bold text-amber-200 active:bg-amber-900 disabled:opacity-40"
                >
                  Now
                </button>
              </div>
            )
          })}
          <div>
            <label className={label}>Note <span className="normal-case tracking-normal font-normal text-zinc-600">— optional</span></label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. waited 40 min at the gate" className={field} />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={readOnly || busy || !workDate || !stamps.leftLot}
              className="min-h-[48px] flex-1 rounded-xl bg-amber-500 px-5 py-3 text-[16px] font-bold text-zinc-950 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-50"
            >
              {busy ? 'Saving…' : stamps.wrap ? 'Save day (wrapped)' : 'Save so far'}
            </button>
            {entries.length > 0 && (
              <button onClick={() => setOpen(false)} className="min-h-[48px] px-3 text-[14px] text-zinc-400 hover:text-white">Done</button>
            )}
          </div>
          <p className="text-[12px] text-zinc-500">A wrap earlier on the clock than left-lot means you worked past midnight. Hours are wrap minus left-lot.</p>
        </div>
      ) : (
        (prompt || entries.length > 0) && !readOnly && (
          <button onClick={() => { setWorkDate(defaultDate); setOpen(true) }} className="mt-3 min-h-[48px] w-full rounded-xl border border-zinc-700 px-4 py-3 text-[15px] font-semibold text-white hover:border-zinc-500 active:bg-zinc-800">
            {entries.length ? 'Log another day' : 'Log today'}
          </button>
        )
      )}
    </section>
  )
}
