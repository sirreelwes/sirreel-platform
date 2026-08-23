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
}
interface VehicleRow {
  bookingAssignmentId: string
  unitName: string
  description: string | null
  startDate: string
  endDate: string
  drivers: DriverRow[]
}

const fmtDay = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })

export function PortalDriversSection() {
  const [vehicles, setVehicles] = useState<VehicleRow[] | null>(null)
  const [openFor, setOpenFor] = useState<string | null>(null)
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
  }, [])
  useEffect(() => { void load() }, [load])

  async function submit(bookingAssignmentId: string) {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const res = await fetch('/api/portal/job/drivers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingAssignmentId, email, firstName: firstName || undefined }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not add that driver')
      setMsg(
        j.emailSent
          ? `We've emailed ${email} with the pickup details and a request for their license.`
          : `Driver added. We couldn't send the email — please pass on their details to us.`,
      )
      setEmail(''); setFirstName(''); setOpenFor(null)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add that driver')
    } finally { setBusy(false) }
  }

  // Nothing to show until vehicles are actually assigned to the job.
  if (!vehicles || vehicles.length === 0) return null

  return (
    <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-900">Your drivers</h2>
        <span className="text-xs text-gray-400">{vehicles.length} vehicle{vehicles.length === 1 ? '' : 's'}</span>
      </div>
      <p className="text-xs leading-relaxed text-gray-500">
        Tell us who&rsquo;s collecting each vehicle and we&rsquo;ll email them the pickup
        details and ask for a photo of their license. <strong>We can&rsquo;t release a
        vehicle without one</strong>, so the earlier the better.
      </p>

      {msg && <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">{msg}</div>}
      {err && <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">{err}</div>}

      <div className="divide-y divide-gray-100">
        {vehicles.map((v) => (
          <div key={v.bookingAssignmentId} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">{v.unitName}</div>
                <div className="text-[11px] text-gray-500">
                  {v.description}
                  {' · '}{fmtDay(v.startDate)}
                  {v.endDate !== v.startDate && <> – {fmtDay(v.endDate)}</>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setOpenFor(openFor === v.bookingAssignmentId ? null : v.bookingAssignmentId); setErr(null); setMsg(null) }}
                className="flex-shrink-0 text-xs font-semibold text-gray-900 underline underline-offset-2 hover:text-gray-600"
              >
                {openFor === v.bookingAssignmentId ? 'Cancel' : v.drivers.length ? '+ Another driver' : '+ Add driver'}
              </button>
            </div>

            {v.drivers.length > 0 && (
              <ul className="mt-2 space-y-1">
                {v.drivers.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="min-w-0 truncate text-gray-700">
                      {d.name}{d.email ? ` · ${d.email}` : ''}
                    </span>
                    <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      d.ready ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {d.ready ? 'License received' : d.opened ? 'Opened — no license yet' : 'Emailed'}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {openFor === v.bookingAssignmentId && (
              <div className="mt-2.5 space-y-2 rounded-xl bg-gray-50 border border-gray-200 p-3">
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
                <button
                  type="button" onClick={() => submit(v.bookingAssignmentId)}
                  disabled={busy || !email.trim()}
                  className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40"
                >
                  {busy ? 'Sending…' : 'Send them the details'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
