'use client'

/**
 * "Your drivers" — the production client names who is collecting each
 * vehicle, from their own job page (Wes 2026-08-22).
 *
 * The client is the one who actually knows this, often days before we do,
 * so letting them enter it removes a phone call and gets the licence
 * request moving early. Email only: it's the identity we match drivers on,
 * so a driver who has worked with us before is already covered.
 *
 * DRIVER FIRST (Wes 2026-08-26). A coordinator knows the driver before
 * they know or care which unit number it is, so the entry is one button
 * and the vehicle is a prompt after the email: "Assign this driver to:".
 * One vehicle on the job and it's preselected; more than one and they
 * pick, because we cannot guess and a driver on the wrong truck is a
 * failed pickup.
 *
 * The client never sees our licence verdicts — "waiting on them" vs
 * "ready" is all they need, and their driver's licence details are not
 * theirs to read.
 */

import { useCallback, useEffect, useState } from 'react'

interface DriverRow {
  id: string
  name: string
  email: string | null
  opened: boolean
  ready: boolean
  /** Pending only — a driver who has sent a licence is staff-only to change. */
  removable?: boolean
}
interface VehicleRow {
  bookingAssignmentId: string
  unitName: string
  description: string | null
  startDate: string
  endDate: string
  drivers: DriverRow[]
}
/** Booked, but we haven't picked the specific unit yet. */
interface PendingHold {
  bookingItemId: string
  description: string
  quantity: number
  startDate: string
  endDate: string
}

const fmtDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
const range = (start: string, end: string) =>
  end !== start ? `${fmtDay(start)} – ${fmtDay(end)}` : fmtDay(start)

export function PortalDriversSection() {
  const [vehicles, setVehicles] = useState<VehicleRow[] | null>(null)
  const [pendingHolds, setPendingHolds] = useState<PendingHold[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [target, setTarget] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/portal/job/drivers')
    if (!res.ok) { setVehicles([]); return }
    const j = await res.json()
    setVehicles(j.vehicles ?? [])
    setPendingHolds(j.pendingHolds ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  const only = vehicles && vehicles.length === 1 ? vehicles[0].bookingAssignmentId : null

  useEffect(() => {
    if (formOpen && only && !target) setTarget(only)
  }, [formOpen, only, target])

  const openForm = useCallback((preselect?: string) => {
    setFormOpen(true)
    setTarget(preselect ?? only ?? null)
    setErr(null); setMsg(null)
  }, [only])

  const closeForm = useCallback(() => {
    setFormOpen(false); setTarget(null); setEmail(''); setFirstName('')
  }, [])

  async function submit() {
    if (!target) { setErr('Please choose which vehicle this driver is collecting.'); return }
    setBusy(true); setErr(null); setMsg(null)
    try {
      const res = await fetch('/api/portal/job/drivers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingAssignmentId: target, email, firstName: firstName || undefined }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not add that driver')
      const unit = vehicles?.find((v) => v.bookingAssignmentId === target)?.unitName ?? 'the vehicle'
      setMsg(
        j.emailSent
          ? `We've emailed ${email} the pickup details for ${unit} and a request for their license.`
          : `Driver added to ${unit}. We couldn't send the email — please pass on their details to us.`,
      )
      closeForm()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add that driver')
    } finally { setBusy(false) }
  }

  async function remove(driverAssignmentId: string, name: string) {
    if (!window.confirm(`Remove ${name}? They'll lose access to the pickup details.`)) return
    setBusy(true); setErr(null); setMsg(null)
    try {
      const res = await fetch('/api/portal/job/drivers', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ driverAssignmentId }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not remove that driver')
      setMsg(`${name} removed. Add whoever is collecting instead and we'll email them.`)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove that driver')
    } finally { setBusy(false) }
  }

  // Nothing booked at all — nothing honest to say.
  if (!vehicles || (vehicles.length === 0 && pendingHolds.length === 0)) return null

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">Your drivers</h2>
        {vehicles.length > 0 ? (
          <button
            type="button"
            onClick={() => (formOpen ? closeForm() : openForm())}
            className="text-xs font-semibold text-gray-900 underline underline-offset-2 hover:text-gray-600"
          >
            {formOpen ? 'Cancel' : '+ Add driver'}
          </button>
        ) : (
          <span className="text-xs text-gray-400">
            {pendingHolds.length} vehicle{pendingHolds.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className="text-xs leading-relaxed text-gray-500">
        Tell us who&rsquo;s collecting each vehicle and we&rsquo;ll email them the pickup
        details and ask for a photo of their license. <strong>We can&rsquo;t release a
        vehicle without one</strong>, so the earlier the better.
      </p>

      {msg && <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">{msg}</div>}
      {err && <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">{err}</div>}

      {formOpen && vehicles.length > 0 && (
        <div className="space-y-2 rounded-xl bg-gray-50 border border-gray-200 p-3">
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="Driver's email"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            value={firstName} onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name (optional)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />

          <div className="pt-1">
            <div className="text-xs font-semibold text-gray-700">Assign this driver to:</div>
            {only ? (
              <div className="mt-1 text-sm text-gray-900">
                {vehicles[0].unitName}
                <span className="text-gray-500">
                  {vehicles[0].description ? ` · ${vehicles[0].description}` : ''}
                  {' · '}{range(vehicles[0].startDate, vehicles[0].endDate)}
                </span>
              </div>
            ) : (
              <div className="mt-1.5 space-y-1">
                {vehicles.map((v) => (
                  <label
                    key={v.bookingAssignmentId}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      target === v.bookingAssignmentId
                        ? 'border-gray-900 bg-white text-gray-900'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name="portal-driver-target"
                      className="accent-gray-900"
                      checked={target === v.bookingAssignmentId}
                      onChange={() => setTarget(v.bookingAssignmentId)}
                    />
                    <span className="min-w-0 truncate">
                      {v.unitName}
                      <span className="text-gray-400">
                        {' · '}{range(v.startDate, v.endDate)}
                      </span>
                    </span>
                    {v.drivers.length > 0 && (
                      <span className="ml-auto flex-shrink-0 text-[10px] text-gray-400">
                        {v.drivers.length} named
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          <button
            type="button" onClick={submit}
            disabled={busy || !email.trim() || !target}
            className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
          >
            {busy ? 'Sending…' : 'Send them the details'}
          </button>
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {vehicles.map((v) => (
          <div key={v.bookingAssignmentId} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">{v.unitName}</div>
                <div className="text-[11px] text-gray-500">
                  {v.description}
                  {' · '}{range(v.startDate, v.endDate)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => openForm(v.bookingAssignmentId)}
                className="flex-shrink-0 text-xs font-semibold text-gray-900 underline underline-offset-2 hover:text-gray-600"
              >
                {v.drivers.length ? '+ Another driver' : '+ Add driver'}
              </button>
            </div>

            {v.drivers.length > 0 && (
              <ul className="mt-2 space-y-1">
                {v.drivers.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="min-w-0 truncate text-gray-700">
                      {d.name}{d.email ? ` · ${d.email}` : ''}
                    </span>
                    <span className="flex flex-shrink-0 items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        d.ready ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {d.ready ? 'License received' : d.opened ? 'Opened — no license yet' : 'Emailed'}
                      </span>
                      {/* Only while pending. Once a licence is in we keep the
                          driver and let the client call — see the route. */}
                      {d.removable && (
                        <button
                          type="button"
                          onClick={() => remove(d.id, d.name)}
                          disabled={busy}
                          title={`Remove ${d.name}`}
                          className="text-[11px] font-semibold text-gray-400 underline underline-offset-2 hover:text-rose-600 disabled:opacity-40"
                        >
                          Remove
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* Booked, but we haven't picked the unit yet. Naming a driver needs a
          specific vehicle, so there's nothing for them to add here — better
          to say that than to hide the section on a job that IS booked. */}
      {pendingHolds.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {pendingHolds.map((h) => (
            <div key={h.bookingItemId} className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-2.5">
              <div className="text-sm text-gray-700">
                {h.description}{h.quantity > 1 ? ` ×${h.quantity}` : ''}
                <span className="text-gray-400"> · {range(h.startDate, h.endDate)}</span>
              </div>
              <div className="text-[11px] text-gray-500">
                We&rsquo;re still assigning your specific vehicle — we&rsquo;ll ask you for a
                driver as soon as it&rsquo;s set.
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
