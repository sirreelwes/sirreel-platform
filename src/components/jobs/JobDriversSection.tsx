'use client'

/**
 * "Drivers" on the internal job page — the agent's entry point, and the
 * answer to "who's driving each unit on this job?".
 *
 * DRIVER-FIRST (Wes 2026-08-26). The real trigger is a client email
 * naming a driver, which arrives before anyone is thinking about which
 * truck. So the entry is one button, and the vehicle is a PROMPT after
 * the email: "Assign this driver to:". One vehicle on the job and it's
 * preselected — there is no choice to make; more than one and the pick is
 * required, because guessing which truck someone drives is exactly the
 * error this screen exists to prevent. The per-vehicle shortcut stays for
 * fleet, who come at it from the other direction ("who's taking THIS
 * one?") — it opens the same form with that unit already chosen.
 *
 * Same email-first identity as the board popup and the client's portal,
 * all three landing on POST /api/driver-assignments. Email is the
 * identity, so a driver who has worked before keeps their file and
 * their licence.
 *
 * Unlike the client's view, staff DO see the licence verdict and can open
 * the images — they're the ones who have to decide whether the vehicle
 * leaves.
 */

import { useCallback, useEffect, useState } from 'react'

interface DriverRow {
  id: string
  status: string
  emailSentTo: string | null
  firstViewedAt: string | null
  invitedBySource: string
  driver: {
    id: string; firstName: string; lastName: string; phone: string | null
    licenseFrontUrl: string | null; licenseBackUrl: string | null
    licenseExpired: boolean | null; licenseVerified: boolean
  }
}
interface Vehicle {
  bookingAssignmentId: string
  unitName: string
  category: string
  startDate?: string | null
  endDate?: string | null
  drivers: DriverRow[]
}
/** A held category with no unit picked yet — nothing to attach a driver to. */
interface PendingHold {
  bookingItemId: string
  category: string
  quantity: number
  startDate?: string | null
}

const fmtDay = (ymd?: string | null) => {
  if (!ymd) return null
  const d = new Date(`${ymd.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const dateRange = (v: Vehicle) => {
  const a = fmtDay(v.startDate), b = fmtDay(v.endDate)
  if (!a) return null
  return b && b !== a ? `${a} – ${b}` : a
}

export function JobDriversSection({
  vehicles,
  pendingHolds = [],
  onChanged,
}: {
  vehicles: Vehicle[]
  pendingHolds?: PendingHold[]
  onChanged?: () => void
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [target, setTarget] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [first, setFirst] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const only = vehicles.length === 1 ? vehicles[0].bookingAssignmentId : null

  // One vehicle on the job means there is no choice to make — preselect it
  // so the prompt reads as a confirmation rather than a one-option quiz.
  useEffect(() => {
    if (formOpen && only && !target) setTarget(only)
  }, [formOpen, only, target])

  const openForm = useCallback((preselect?: string) => {
    setFormOpen(true)
    setTarget(preselect ?? only ?? null)
    setErr(null); setMsg(null)
  }, [only])

  const closeForm = useCallback(() => {
    setFormOpen(false); setTarget(null); setEmail(''); setFirst('')
  }, [])

  async function removeDriver(driverAssignmentId: string, name: string) {
    if (!window.confirm(`Remove ${name} from this vehicle? Their pickup link stops working.`)) return
    setBusy(true); setErr(null); setMsg(null)
    try {
      const res = await fetch('/api/driver-assignments', {
        method: 'DELETE', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ driverAssignmentId }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not remove that driver')
      setMsg(`${name} removed.`)
      onChanged?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove that driver')
    } finally { setBusy(false) }
  }

  async function invite() {
    if (!target) { setErr('Pick which vehicle this driver is taking.'); return }
    setBusy(true); setErr(null); setMsg(null)
    try {
      const res = await fetch('/api/driver-assignments', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingAssignmentId: target, email, firstName: first || undefined }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not send that invite')
      const unit = vehicles.find((v) => v.bookingAssignmentId === target)?.unitName ?? 'the vehicle'
      setMsg(j.emailSent
        ? `Emailed ${email} — ${unit}.${j.needsLicense ? ' Waiting on their licence.' : ''}`
        : `Driver added to ${unit}, but the email did not send (${j.emailError || 'unknown'}). Link: ${j.url}`)
      closeForm()
      onChanged?.()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send that invite') }
    finally { setBusy(false) }
  }

  // Nothing reserved at all — there is genuinely nothing to say here.
  if (vehicles.length === 0 && pendingHolds.length === 0) return null

  return (
    <div id="drivers" className="scroll-mt-4 bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400">
      <div className="flex items-center justify-between mb-2.5">
        <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Drivers</h2>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-zinc-600">{vehicles.length} unit{vehicles.length === 1 ? '' : 's'}</span>
          {vehicles.length > 0 && (
            <button
              type="button"
              onClick={() => (formOpen ? closeForm() : openForm())}
              className="text-[13px] font-semibold text-amber-700 hover:text-amber-700"
            >
              {formOpen ? 'Cancel' : '+ Name a driver'}
            </button>
          )}
        </div>
      </div>

      {msg && <div className="mb-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">{msg}</div>}
      {err && <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{err}</div>}

      {/* Driver first, vehicle second — the order the information actually
          arrives in. */}
      {formOpen && vehicles.length > 0 && (
        <div className="mb-3 rounded-xl border border-zinc-300 bg-zinc-50 p-3">
          <div className="flex flex-wrap gap-2">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Driver email"
              className="min-w-[180px] flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[13px] text-zinc-900 placeholder:text-zinc-500" />
            <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First name (optional)"
              className="min-w-[140px] flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-[13px] text-zinc-900 placeholder:text-zinc-500" />
          </div>

          <div className="mt-2.5">
            <div className="text-[12px] font-semibold text-zinc-700">Assign this driver to:</div>
            {only ? (
              <div className="mt-1 text-[13px] text-zinc-900">
                {vehicles[0].unitName}
                <span className="text-zinc-600"> · {vehicles[0].category}</span>
                {dateRange(vehicles[0]) && <span className="text-zinc-600"> · {dateRange(vehicles[0])}</span>}
              </div>
            ) : (
              <div className="mt-1.5 space-y-1">
                {vehicles.map((v) => (
                  <label
                    key={v.bookingAssignmentId}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] transition-colors ${
                      target === v.bookingAssignmentId
                        ? 'border-amber-600/70 bg-amber-50 text-zinc-900'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-400'
                    }`}
                  >
                    <input
                      type="radio"
                      name="driver-target"
                      className="accent-amber-500"
                      checked={target === v.bookingAssignmentId}
                      onChange={() => setTarget(v.bookingAssignmentId)}
                    />
                    <span className="min-w-0 truncate">
                      {v.unitName}
                      <span className="text-zinc-600"> · {v.category}</span>
                      {dateRange(v) && <span className="text-zinc-600"> · {dateRange(v)}</span>}
                    </span>
                    {v.drivers.length > 0 && (
                      <span className="ml-auto flex-shrink-0 text-[11px] text-zinc-600">
                        {v.drivers.length} named
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <button onClick={invite} disabled={busy || !email.trim() || !target}
              className="rounded-lg bg-amber-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-amber-500 disabled:opacity-40">
              {busy ? 'Sending…' : 'Send link'}
            </button>
            <button onClick={closeForm} disabled={busy}
              className="text-[12px] font-semibold text-zinc-600 hover:text-zinc-900 disabled:opacity-40">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {vehicles.map((v) => (
          <div key={v.bookingAssignmentId} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[15px] text-zinc-900">{v.unitName}</div>
                <div className="text-[12px] text-zinc-600">
                  {v.category}
                  {dateRange(v) && <span className="text-zinc-600"> · {dateRange(v)}</span>}
                </div>
              </div>
              <button
                onClick={() => openForm(v.bookingAssignmentId)}
                className="flex-shrink-0 text-[13px] font-semibold text-amber-700 hover:text-amber-700"
              >
                {v.drivers.length ? '+ Another' : '+ Name a driver'}
              </button>
            </div>

            {v.drivers.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {v.drivers.map((d) => {
                  const dr = d.driver
                  const hasImages = !!(dr.licenseFrontUrl || dr.licenseBackUrl)
                  const tone = d.status === 'PICKED_UP' ? 'bg-violet-100 text-violet-700'
                    : dr.licenseExpired ? 'bg-rose-100 text-rose-700'
                    : dr.licenseVerified ? 'bg-emerald-100 text-emerald-700'
                    : hasImages ? 'bg-amber-100 text-amber-700'
                    : 'bg-zinc-100 text-zinc-700'
                  // PICKED_UP outranks every licence verdict: the truck is
                  // gone, and "Checked" reads like it's still in the yard.
                  const label = d.status === 'PICKED_UP' ? 'Picked up'
                    : dr.licenseExpired ? 'Licence expired'
                    : dr.licenseVerified ? 'Checked'
                    : hasImages ? 'Needs check'
                    : d.firstViewedAt ? 'Opened, no licence' : 'Invited'
                  return (
                    <div key={d.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] text-zinc-900 truncate">
                          {`${dr.firstName} ${dr.lastName}`.trim() || d.emailSentTo}
                          {dr.phone && <span className="text-zinc-600"> · {dr.phone}</span>}
                        </div>
                        <div className="text-[11px] text-zinc-600 truncate">
                          {d.emailSentTo}
                          {d.invitedBySource === 'CLIENT' && ' · named by client'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {hasImages && (
                          <a href={`/api/drivers/${dr.id}/license/front`} target="_blank" rel="noopener noreferrer"
                            className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700 hover:border-amber-400">
                            Licence ↗
                          </a>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}>{label}</span>
                        {/* Staff can pull a driver at any point before the
                            keys leave — including a checked one, which the
                            client deliberately cannot do. */}
                        {d.status !== 'PICKED_UP' && (
                          <button
                            type="button"
                            onClick={() => removeDriver(d.id, `${dr.firstName} ${dr.lastName}`.trim() || d.emailSentTo || 'this driver')}
                            disabled={busy}
                            title="Remove this driver from the vehicle"
                            className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 hover:border-rose-600 hover:text-rose-700 disabled:opacity-40"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Held but no unit picked. A driver attaches to a UNIT, so there is
          nothing to name them onto yet — say so instead of hiding the card
          and leaving a rep hunting for a button that isn't there. */}
      {pendingHolds.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {pendingHolds.map((h) => (
            <div key={h.bookingItemId} className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="text-[13px] text-zinc-700 truncate">
                  {h.category}{h.quantity > 1 ? ` ×${h.quantity}` : ''}
                </div>
                <div className="text-[11px] text-zinc-600">
                  No unit assigned yet — pick one on the calendar to name a driver
                </div>
              </div>
              {h.startDate && (
                <a
                  href={`/gantt?date=${h.startDate.slice(0, 10)}`}
                  className="flex-shrink-0 text-[12px] font-semibold text-amber-700 hover:text-amber-700"
                >
                  Assign a unit →
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-600">
        The driver gets their vehicle, dates, gate entry and a licence request. The client can
        also name drivers from their own portal page.
      </p>
    </div>
  )
}
