'use client'

/**
 * "Deliveries" — what's arriving, who's bringing it, where they report, and
 * where it goes back from.
 *
 * Sibling of PortalDriversSection, pointing the other way: that section is the
 * client naming who COLLECTS a unit from us; this one tells them who is
 * DELIVERING one to them. They sit next to each other on the job page, so the
 * copy keeps them apart — "arriving" here, "your drivers" there.
 *
 * ── Two windows, not one ────────────────────────────────────────────────────
 * A restroom trailer can't be towed by the client, so we drop it AND collect
 * it (Wes 2026-08-28). Those are two separate promises: two addresses and two
 * times. Pickup defaults to "same place" because that IS the common case, and
 * the override is one checkbox away because the exception — a unit that moved
 * mid-shoot, a production that struck to another lot — is what strands a truck.
 *
 * The TIME is never inherited from the delivery, even when the address is. A
 * trailer dropped at 6am is not collected at 6am, and copying it across would
 * state a confident wrong fact instead of an honest blank.
 *
 * ── One list, no sourcing tells; no phone number, anywhere ──────────────────
 * A partner's coach and one of our own trailers render through the same JSX,
 * and the driver line is a name and a state, never digits. See the sibling
 * notes in src/lib/portal/deliveries.ts for why both rules exist.
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
  editable: boolean
  callTime: string | null
  driverNotes: string | null
  driverAck: { at: string; note: string | null; stale: boolean } | null
  hours: { total: number; days: number }
}
interface Payload {
  units: DeliveryUnit[]
  reportTo: {
    address: string | null
    accessNotes: string | null
    time: string | null
    contactName: string | null
    contactPhone: string | null
    updatedAt: string | null
  }
  pickupFrom: {
    sameAsDelivery: boolean
    address: string | null
    accessNotes: string | null
    time: string | null
  }
  effectivePickup: { address: string | null; accessNotes: string | null; time: string | null }
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
  return (
    d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) +
    ' at ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  )
}

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

  // Per-unit drafts: call time + note for that unit's driver. Kept apart
  // from the job-wide address form above so saving one doesn't touch the
  // other, and so a failed save leaves the typing on screen.
  const [unitDraft, setUnitDraft] = useState<Record<string, { callTime: string; driverNotes: string }>>({})
  const [unitSaving, setUnitSaving] = useState<string | null>(null)
  const [unitErr, setUnitErr] = useState<Record<string, string>>({})
  const [unitSaved, setUnitSaved] = useState<string | null>(null)

  // Draft state is separate from `data` so a failed save leaves what they
  // typed on screen rather than reverting it under them.
  const [address, setAddress] = useState('')
  const [accessNotes, setAccessNotes] = useState('')
  const [time, setTime] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [pickupSame, setPickupSame] = useState(true)
  const [pickupAddress, setPickupAddress] = useState('')
  const [pickupAccessNotes, setPickupAccessNotes] = useState('')
  const [pickupTime, setPickupTime] = useState('')
  const [dirty, setDirty] = useState(false)

  const touch = () => setDirty(true)

  const hydrate = useCallback((p: Payload) => {
    setData(p)
    setUnitDraft(Object.fromEntries(p.units.map((u) => [u.id, { callTime: u.callTime ?? '', driverNotes: u.driverNotes ?? '' }])))
    setAddress(p.reportTo.address ?? '')
    setAccessNotes(p.reportTo.accessNotes ?? '')
    setTime(p.reportTo.time ?? '')
    setContactName(p.reportTo.contactName ?? '')
    setContactPhone(p.reportTo.contactPhone ?? '')
    setPickupSame(p.pickupFrom.sameAsDelivery)
    setPickupAddress(p.pickupFrom.address ?? '')
    setPickupAccessNotes(p.pickupFrom.accessNotes ?? '')
    setPickupTime(p.pickupFrom.time ?? '')
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
        /* additive section — never the reason a page fails */
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
        body: JSON.stringify({
          address,
          accessNotes,
          time,
          contactName,
          contactPhone,
          pickupSameAsDelivery: pickupSame,
          pickupAddress,
          pickupAccessNotes,
          pickupTime,
        }),
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

  async function saveUnit(u: DeliveryUnit) {
    const d = unitDraft[u.id]
    if (!d) return
    setUnitSaving(u.id)
    setUnitErr((e) => ({ ...e, [u.id]: '' }))
    setUnitSaved(null)
    try {
      const r = await fetch('/api/portal/job/deliveries/unit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId: u.id, callTime: d.callTime, driverNotes: d.driverNotes }),
      })
      const j = await r.json()
      if (!r.ok) {
        setUnitErr((e) => ({ ...e, [u.id]: j.error ?? "That didn't save. Try again in a moment." }))
        return
      }
      hydrate(j as Payload)
      setUnitSaved(u.id)
    } catch {
      setUnitErr((e) => ({ ...e, [u.id]: "That didn't save — check your connection and try again." }))
    } finally {
      setUnitSaving(null)
    }
  }
  const unitDirty = (u: DeliveryUnit) => {
    const d = unitDraft[u.id]
    return !!d && (d.callTime !== (u.callTime ?? '') || d.driverNotes !== (u.driverNotes ?? ''))
  }

  if (loading || !data || data.units.length === 0) return null

  const savedAt = fmtSaved(data.reportTo.updatedAt)
  const hasAddress = !!data.reportTo.address

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
      <div>
        <h2 className="text-base font-bold text-gray-900">Deliveries</h2>
        <p className="text-xs text-gray-500 mt-1">
          {data.units.length === 1 ? 'One unit is' : `${data.units.length} units are`} coming to you.
          Tell us where and when to drop them, and where and when to collect them — we pass it
          straight to the drivers.
        </p>
      </div>

      {/* ── Delivery ──────────────────────────────────────────────────────── */}
      <div className="bg-[#FBFAF8] border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-bold text-gray-900">Delivery — where and when</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Give the gate, lot or cross-street a truck should aim for — not the production
              office, if they&apos;re different.
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
            <label className={LABEL} htmlFor="rt-address">Delivery address</label>
            <input id="rt-address" className={INPUT} value={address}
              placeholder="11801 Wentworth St, Sun Valley, CA 91352"
              onChange={(e) => { setAddress(e.target.value); touch() }} />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL} htmlFor="rt-notes">Gate, lot or access notes</label>
            <input id="rt-notes" className={INPUT} value={accessNotes}
              placeholder="North gate off Wentworth, code #4412 — park along the east fence"
              onChange={(e) => { setAccessNotes(e.target.value); touch() }} />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL} htmlFor="rt-time">What time should they arrive?</label>
            <input id="rt-time" className={INPUT} value={time}
              placeholder="6:00–7:00 AM, or “first light”"
              onChange={(e) => { setTime(e.target.value); touch() }} />
          </div>
          <div>
            <label className={LABEL} htmlFor="rt-contact">On-site contact</label>
            <input id="rt-contact" className={INPUT} value={contactName}
              placeholder="Who the driver asks for"
              onChange={(e) => { setContactName(e.target.value); touch() }} />
          </div>
          <div>
            <label className={LABEL} htmlFor="rt-phone">Their mobile</label>
            <input id="rt-phone" className={INPUT} value={contactPhone}
              placeholder="(818) 555-0147"
              onChange={(e) => { setContactPhone(e.target.value); touch() }} />
          </div>
        </div>
      </div>

      {/* ── Pickup ────────────────────────────────────────────────────────── */}
      <div className="bg-[#FBFAF8] border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-gray-900">Pickup — where and when</div>
          <div className="text-xs text-gray-500 mt-0.5">
            Everything we drop, we collect. Tell us if it moves before then.
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={pickupSame}
            onChange={(e) => { setPickupSame(e.target.checked); touch() }}
            className="accent-gray-900" />
          <span>Collect from the same place we delivered</span>
        </label>

        <div className="grid grid-cols-1 gap-3">
          {!pickupSame && (
            <>
              <div>
                <label className={LABEL} htmlFor="pu-address">Pickup address</label>
                <input id="pu-address" className={INPUT} value={pickupAddress}
                  placeholder="Where the unit will be when we come for it"
                  onChange={(e) => { setPickupAddress(e.target.value); touch() }} />
              </div>
              <div>
                <label className={LABEL} htmlFor="pu-notes">Gate, lot or access notes</label>
                <input id="pu-notes" className={INPUT} value={pickupAccessNotes}
                  placeholder="How the driver gets to it"
                  onChange={(e) => { setPickupAccessNotes(e.target.value); touch() }} />
              </div>
            </>
          )}
          <div>
            <label className={LABEL} htmlFor="pu-time">What time should they collect?</label>
            <input id="pu-time" className={INPUT} value={pickupTime}
              placeholder="After wrap, or a time"
              onChange={(e) => { setPickupTime(e.target.value); touch() }} />
            <p className="mt-1 text-[11px] text-gray-500">
              We don&apos;t assume this from the delivery time — a trailer dropped at 6am is
              rarely collected at 6am.
            </p>
          </div>
        </div>
      </div>

      {error && <div className="text-xs text-red-600">{error}</div>}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs text-gray-500">
          {savedAt
            ? `Saved ${savedAt}${data.anyDriverNamed ? ' — your drivers have it' : ''}`
            : 'Not saved yet'}
        </span>
        <button type="button" onClick={save} disabled={saving || !dirty}
          className="px-4 py-2 text-xs font-bold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-default transition">
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>

      {/* ── Units ─────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {data.units.map((u) => {
          const day = fmtDay(u.startDate)
          const backDay = u.sameDay ? day : fmtDay(u.endDate)
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

                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="text-xs text-gray-600">
                    <span className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold block">Drop off</span>
                    <span className="font-semibold text-gray-900">{day ?? 'TBC'}</span>
                    {data.reportTo.time && <> · {data.reportTo.time}</>}
                    {data.reportTo.address && (
                      <div className="text-[11px] text-gray-500 mt-0.5">{data.reportTo.address}</div>
                    )}
                  </div>
                  <div className="text-xs text-gray-600">
                    <span className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold block">Collect</span>
                    <span className="font-semibold text-gray-900">{backDay ?? 'TBC'}</span>
                    {data.effectivePickup.time && <> · {data.effectivePickup.time}</>}
                    {data.effectivePickup.address && (
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {data.effectivePickup.address}
                        {data.pickupFrom.sameAsDelivery && <span className="text-gray-400"> (same as drop off)</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Call time + note for THIS unit's driver ─────────────────
                  Job-wide address above; per-unit time here, because two units
                  on one lot don't report at the same hour. Saving tells the
                  driver (and whoever is sending them) straight away. */}
              {u.editable && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,160px)_1fr] gap-2">
                    <div>
                      <label className={LABEL} htmlFor={`ct-${u.id}`}>Call time for this unit</label>
                      <input id={`ct-${u.id}`} className={INPUT} value={unitDraft[u.id]?.callTime ?? ''}
                        placeholder="6:00 AM"
                        onChange={(e) => setUnitDraft((m) => ({ ...m, [u.id]: { callTime: e.target.value, driverNotes: m[u.id]?.driverNotes ?? '' } }))} />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor={`dn-${u.id}`}>Note for the driver</label>
                      <input id={`dn-${u.id}`} className={INPUT} value={unitDraft[u.id]?.driverNotes ?? ''}
                        placeholder="Park along the east fence; ask for Jamie at the gate"
                        onChange={(e) => setUnitDraft((m) => ({ ...m, [u.id]: { callTime: m[u.id]?.callTime ?? '', driverNotes: e.target.value } }))} />
                    </div>
                  </div>
                  {unitErr[u.id] && <div className="text-xs text-red-600">{unitErr[u.id]}</div>}
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-[11px] text-gray-500">
                      {unitSaved === u.id
                        ? u.driver ? `Sent to ${u.driver.name}.` : 'Saved — goes to the driver the moment one is named.'
                        : u.driver ? 'Changes go straight to the driver.' : 'Goes to the driver as soon as one is named.'}
                    </span>
                    <button type="button" onClick={() => saveUnit(u)} disabled={unitSaving === u.id || !unitDirty(u)}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-default transition">
                      {unitSaving === u.id ? 'Sending…' : unitDirty(u) ? (u.driver ? 'Send to driver' : 'Save') : 'Saved'}
                    </button>
                  </div>
                </div>
              )}

              {u.driver ? (
                <>
                  <div className="border-t border-gray-100 bg-[#FCFCFB] px-4 py-3 flex items-center gap-3 flex-wrap">
                    <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 font-bold text-xs flex items-center justify-center flex-shrink-0">
                      {initials(u.driver.name)}
                    </div>
                    <div className="flex-1 min-w-[140px]">
                      <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Your driver</div>
                      <div className="text-sm font-bold text-gray-900">{u.driver.name}</div>
                      {/* Did the details reach them? The thing a coordinator
                          actually wants to know the night before. */}
                      <div className="text-[11px] mt-0.5">
                        {u.driverAck && !u.driverAck.stale ? (
                          <span className="text-green-700 font-semibold">Confirmed location &amp; call time {fmtSaved(u.driverAck.at)}</span>
                        ) : u.driverAck?.stale ? (
                          <span className="text-amber-700 font-semibold">Confirmed an earlier version — we&apos;ve sent the change, waiting on them</span>
                        ) : hasAddress || u.callTime ? (
                          <span className="text-gray-500">Details sent — waiting for them to confirm</span>
                        ) : (
                          <span className="text-gray-500">Add the address and call time and they&apos;ll be sent to them</span>
                        )}
                        {u.driverAck?.note && <span className="block text-gray-600 mt-0.5">&ldquo;{u.driverAck.note}&rdquo;</span>}
                        {u.hours.days > 0 && (
                          <span className="block text-gray-600 mt-0.5">Logged {u.hours.total} hrs over {u.hours.days} {u.hours.days === 1 ? 'day' : 'days'}</span>
                        )}
                      </div>
                    </div>
                    <button type="button" onClick={() => setOpenProfile(isOpen ? null : u.id)} aria-expanded={isOpen}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
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
                        {u.editable
                          ? 'A changed gate or a later call time: update it above and the driver is told straight away, through SirReel. It stays on the record for your job.'
                          : 'Anything the driver needs to know — a changed gate, a later call time — goes through your SirReel rep, whose details are further down this page. We pass it straight on, and it stays on the record for your job.'}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="border-t border-gray-100 bg-[#FCFCFB] px-4 py-3 text-xs text-gray-500 leading-relaxed">
                  <span className="font-semibold text-gray-600">Drivers are named closer to the date.</span>{' '}
                  We&apos;ll add them here as soon as they are.
                  {hasAddress && ' Your addresses are already on file and go to them automatically.'}
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
