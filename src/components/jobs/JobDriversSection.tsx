'use client'

/**
 * "Drivers" on the internal job page — the agent's entry point, and the
 * answer to "who's driving each unit on this job?".
 *
 * Same email-first flow as the board popup and the client's portal, all
 * three landing on POST /api/driver-assignments. Email is the identity, so
 * a driver who has worked before keeps their file and their licence.
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
  drivers: DriverRow[]
}

export function JobDriversSection({ vehicles, onChanged }: { vehicles: Vehicle[]; onChanged?: () => void }) {
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [first, setFirst] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

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

  async function invite(bookingAssignmentId: string) {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const res = await fetch('/api/driver-assignments', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingAssignmentId, email, firstName: first || undefined }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not send that invite')
      setMsg(j.emailSent
        ? `Emailed ${email}.${j.needsLicense ? ' Waiting on their licence.' : ''}`
        : `Driver added, but the email did not send (${j.emailError || 'unknown'}). Link: ${j.url}`)
      setEmail(''); setFirst(''); setOpenFor(null)
      onChanged?.()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not send that invite') }
    finally { setBusy(false) }
  }

  if (vehicles.length === 0) return null

  return (
    <div id="drivers" className="scroll-mt-4 bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-700/70">
      <div className="flex items-center justify-between mb-2.5">
        <h2 className="text-[15px] font-semibold text-white flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">Drivers</h2>
        <span className="text-[12px] text-zinc-400">{vehicles.length} unit{vehicles.length === 1 ? '' : 's'}</span>
      </div>

      {msg && <div className="mb-2 rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-[12px] text-emerald-200">{msg}</div>}
      {err && <div className="mb-2 rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-[12px] text-rose-200">{err}</div>}

      <div className="space-y-2">
        {vehicles.map((v) => (
          <div key={v.bookingAssignmentId} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3.5 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[15px] text-white">{v.unitName}</div>
                <div className="text-[12px] text-zinc-400">{v.category}</div>
              </div>
              <button
                onClick={() => { setOpenFor(openFor === v.bookingAssignmentId ? null : v.bookingAssignmentId); setErr(null); setMsg(null) }}
                className="flex-shrink-0 text-[13px] font-semibold text-amber-400 hover:text-amber-300"
              >
                {openFor === v.bookingAssignmentId ? 'Cancel' : v.drivers.length ? '+ Another' : '+ Name a driver'}
              </button>
            </div>

            {v.drivers.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {v.drivers.map((d) => {
                  const dr = d.driver
                  const hasImages = !!(dr.licenseFrontUrl || dr.licenseBackUrl)
                  const tone = dr.licenseExpired ? 'bg-rose-500/15 text-rose-300'
                    : dr.licenseVerified ? 'bg-emerald-500/15 text-emerald-300'
                    : hasImages ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-zinc-700/40 text-zinc-300'
                  const label = dr.licenseExpired ? 'Licence expired'
                    : dr.licenseVerified ? 'Checked'
                    : hasImages ? 'Needs check'
                    : d.firstViewedAt ? 'Opened, no licence' : 'Invited'
                  return (
                    <div key={d.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] text-white truncate">
                          {`${dr.firstName} ${dr.lastName}`.trim() || d.emailSentTo}
                          {dr.phone && <span className="text-zinc-400"> · {dr.phone}</span>}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate">
                          {d.emailSentTo}
                          {d.invitedBySource === 'CLIENT' && ' · named by client'}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {hasImages && (
                          <a href={`/api/drivers/${dr.id}/license/front`} target="_blank" rel="noopener noreferrer"
                            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300 hover:border-amber-600">
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
                            className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400 hover:border-rose-600 hover:text-rose-300 disabled:opacity-40"
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

            {openFor === v.bookingAssignmentId && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Driver email"
                  className="min-w-[180px] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[13px] text-white placeholder:text-zinc-500" />
                <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First name (optional)"
                  className="min-w-[140px] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[13px] text-white placeholder:text-zinc-500" />
                <button onClick={() => invite(v.bookingAssignmentId)} disabled={busy || !email.trim()}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-amber-500 disabled:opacity-40">
                  {busy ? 'Sending…' : 'Send link'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-500">
        The driver gets their vehicle, dates, gate entry and a licence request. The client can
        also name drivers from their own portal page.
      </p>
    </div>
  )
}
