'use client'

/**
 * "Deliveries" — what's arriving, who's bringing it, and where they report.
 *
 * Sibling of PortalDriversSection, pointing the other way: that section is the
 * client naming who COLLECTS a unit from us; this one tells them who is
 * DELIVERING one to them. They sit next to each other on the job page, so the
 * copy keeps them apart — "arriving" here, "your drivers" there.
 *
 * ── One list, no sourcing tells ─────────────────────────────────────────────
 * A partner's coach and one of our own trailers render through the same JSX.
 * The API doesn't send a source field and this file never asks for one, which
 * is what keeps the sub-rental conduit intact at the last mile: the client
 * cannot tell which unit came off somebody else's yard.
 *
 * ── No phone number, anywhere ───────────────────────────────────────────────
 * The driver line is a name and a state. The relay exists precisely so neither
 * side learns the other's address, and a number here would break it in one hop
 * and move the conversation somewhere HQ can't see. Questions go to the rep,
 * whose card is already on this page.
 */

import { useCallback, useEffect, useState } from 'react'

interface DeliveryUnit {
  id: string
  unitName: string
  unitType: string | null
  startDate: string | null
  endDate: string | null
  sameDay: boolean
  driver: { name: string; assignedAt: string | null } | null
}
interface ReportTo {
  address: string | null
  accessNotes: string | null
  contactName: string | null
  contactPhone: string | null
  updatedAt: string | null
}
interface Payload {
  units: DeliveryUnit[]
  reportTo: ReportTo
  anyDriverNamed: boolean
}

const fmtDay = (ymd: string | null) =>
  ymd
    ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'long',
        day: 'numeric',
      })
    : null

function fmtSaved(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    + ' at '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** Initials for the driver avatar. Two letters max; a single-word name gives one. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

const LABEL = 'block text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-1'
const INPUT =
  'w-full text-sm text-gray-900 bg-white border border-gray-300 rounded-lg px-3 py-2 ' +
  'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500'

export function PortalDeliveriesSection() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openProfile, setOpenProfile] = useState<string | null>(null)

  // Draft is separate from `data` so a save that fails leaves what they typed
  // on screen rather than reverting it under them.
  const [address, setAddress] = useState('')
  const [accessNotes, setAccessNotes] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [dirty, setDirty] = useState(false)

  const hydrate = useCallback((p: Payload) => {
    setData(p)
    setAddress(p.reportTo.address ?? '')
    setAccessNotes(p.reportTo.accessNotes ?? '')
    setContactName(p.reportTo.contactName ?? '')
    setContactPhone(p.reportTo.contactPhone ?? '')
    setDirty(false)
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/portal/job/deliveries')
        if (!r.ok) return
        const j = (await r.json()) as Payload
        if (alive) hydrate(j)
      } catch {
        /* section stays hidden — it is additive, never the reason a page fails */
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [hydrate])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const r = await fetch('/api/portal/job/deliveries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, accessNotes, contactName, contactPhone }),
      })
      const j = await r.json()
      if (!r.ok) {
        setError(j.error ?? "That didn't save. Try again in a moment.")
        return
      }
      hydrate(j as Payload)
    } catch {
      setError("That didn't save — check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  // Nothing is coming to them: no section at all. An empty "Deliveries" card on
  // a job where the client collects everything themselves is just confusing.
  if (loading || !data || data.units.length === 0) return null

  const savedAt = fmtSaved(data.reportTo.updatedAt)
  const hasAddress = !!data.reportTo.address

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
      <div>
        <h2 className="text-base font-bold text-gray-900">Deliveries</h2>
        <p className="text-xs text-gray-500 mt-1">
          {data.units.length === 1 ? 'One unit is' : `${data.units.length} units are`} coming to you.
          Tell us where the drivers should report and we'll pass it straight to them.
        </p>
      </div>

      {/* ── Report-to ─────────────────────────────────────────────────────── */}
      <div className="bg-[#FBFAF8] border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-bold text-gray-900">Where should drivers report?</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Include the gate, lot or cross-street a truck should aim for — not the production
              office, if they're different.
            </div>
          </div>
          {hasAddress && (
            <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded-full bg-green-100 text-green-700 whitespace-nowrap">
              On file
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={LABEL} htmlFor="rt-address">Report-to address</label>
            <input
              id="rt-address"
              className={INPUT}
              value={address}
              placeholder="11801 Wentworth St, Sun Valley, CA 91352"
              onChange={(e) => { setAddress(e.target.value); setDirty(true) }}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL} htmlFor="rt-notes">Gate, lot or access notes</label>
            <input
              id="rt-notes"
              className={INPUT}
              value={accessNotes}
              placeholder="North gate off Wentworth, code #4412 — park along the east fence"
              onChange={(e) => { setAccessNotes(e.target.value); setDirty(true) }}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="rt-contact">On-site contact</label>
            <input
              id="rt-contact"
              className={INPUT}
              value={contactName}
              placeholder="Who the driver asks for"
              onChange={(e) => { setContactName(e.target.value); setDirty(true) }}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="rt-phone">Their mobile</label>
            <input
              id="rt-phone"
              className={INPUT}
              value={contactPhone}
              placeholder="(818) 555-0147"
              onChange={(e) => { setContactPhone(e.target.value); setDirty(true) }}
            />
          </div>
        </div>

        {error && <div className="text-xs text-red-600">{error}</div>}

        <div className="border-t border-gray-100 pt-3 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs text-gray-500">
            {savedAt
              ? `Saved ${savedAt}${data.anyDriverNamed ? ' — your drivers have it' : ''}`
              : 'Not saved yet'}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-default transition"
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      {/* ── Units ─────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {data.units.map((u) => {
          const day = fmtDay(u.startDate)
          const back = u.sameDay ? 'back same day' : fmtDay(u.endDate) ? `back ${fmtDay(u.endDate)}` : null
          const isOpen = openProfile === u.id
          return (
            <article key={u.id} className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-gray-900">{u.unitName}</span>
                  {u.driver ? (
                    <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                      Driver assigned
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      Driver being named
                    </span>
                  )}
                </div>
                {u.unitType && <div className="text-xs text-gray-500 mt-0.5">{u.unitType}</div>}
                {day && (
                  <div className="text-xs text-gray-600 mt-1.5">
                    Arriving <span className="font-semibold text-gray-900">{day}</span>
                    {back ? ` · ${back}` : ''}
                  </div>
                )}
                {hasAddress && (
                  <div className="text-[11px] text-gray-500 mt-1">
                    Reporting to {data.reportTo.address}
                  </div>
                )}
              </div>

              {u.driver ? (
                <>
                  <div className="border-t border-gray-100 bg-[#FCFCFB] px-4 py-3 flex items-center gap-3 flex-wrap">
                    <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 font-bold text-xs flex items-center justify-center flex-shrink-0">
                      {initials(u.driver.name)}
                    </div>
                    <div className="flex-1 min-w-[140px]">
                      <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">
                        Your driver
                      </div>
                      <div className="text-sm font-bold text-gray-900">{u.driver.name}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenProfile(isOpen ? null : u.id)}
                      aria-expanded={isOpen}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
                    >
                      {isOpen ? 'Hide profile' : 'View profile'}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="border-t border-gray-100 bg-[#FAFAF8] px-4 py-4 space-y-3">
                      <div className="flex gap-3 items-start">
                        <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-700 font-bold text-base flex items-center justify-center flex-shrink-0">
                          {initials(u.driver.name)}
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 flex-1">
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Driving</div>
                            <div className="text-xs font-semibold text-gray-900">{u.unitName}</div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Arriving</div>
                            <div className="text-xs font-semibold text-gray-900">{day ?? 'TBC'}</div>
                          </div>
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-500 leading-relaxed">
                        Anything the driver needs to know — a changed gate, a later call time —
                        goes through your SirReel rep, whose details are further down this page.
                        We pass it straight on, and it stays on the record for your job.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="border-t border-gray-100 bg-[#FCFCFB] px-4 py-3 text-xs text-gray-500 leading-relaxed">
                  <span className="font-semibold text-gray-600">Drivers are named closer to the date.</span>{' '}
                  We'll add them here as soon as they are.
                  {hasAddress && ' Your report-to address is already on file and goes to them automatically.'}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default PortalDeliveriesSection
