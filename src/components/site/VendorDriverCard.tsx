'use client'

/**
 * Drivers, on the partner's booking page. Two halves, one card:
 *
 *   THIS JOB'S DRIVER — who is assigned to this unit for this booking, and
 *   how they're doing (page opened, location confirmed, hours logged).
 *   "Assign" picks from the roster; drivers trained on this unit sort first.
 *
 *   YOUR DRIVERS — the partner's roster, shared across all their bookings.
 *   "Add a driver" takes an email (name optional); the driver gets a link
 *   and fills in name, phone, licence photos and which units they're
 *   trained on themselves (Wes 2026-09-05). Resend re-mails the link.
 *
 * Assigning runs the conduit: the driver gets their job page, the
 * production is told who is coming. `readOnly` is the HQ preview.
 */

import { useState } from 'react'

export interface RosterDriverRow {
  id: string
  email: string
  name: string
  phone: string | null
  invitedAt: string | null
  profileViewedAt: string | null
  profileCompletedAt: string | null
  licenseFront: boolean
  licenseBack: boolean
  trainedVehicles: { id: string; name: string }[]
  trainedOnThisUnit: boolean
}

export interface VendorDriverState {
  driverPageSent: boolean
  driverViewedAt: string | null
  driverAck: { at: string; note: string | null; stale: boolean } | null
  hours: { total: number; days: number }
}

const ASSIGNABLE = ['REQUESTED', 'CONFIRMED', 'PICKED_UP', 'ON_RENT', 'ESTIMATED']

export default function VendorDriverCard({
  token,
  status,
  unitName,
  roster: initialRoster,
  assignedVendorDriverId,
  initialDriverName,
  initialDriverEmail,
  initialDriverPhone,
  initialRelayAddress,
  state,
  readOnly = false,
}: {
  token: string
  status: string
  unitName: string
  roster: RosterDriverRow[]
  assignedVendorDriverId: string | null
  initialDriverName: string | null
  initialDriverEmail: string | null
  initialDriverPhone: string | null
  initialRelayAddress: string | null
  state: VendorDriverState
  readOnly?: boolean
}) {
  const [roster, setRoster] = useState<RosterDriverRow[]>(initialRoster)
  const [assigned, setAssigned] = useState<{ id: string | null; name: string; email: string; phone: string | null; relay: string | null } | null>(
    initialDriverName && initialDriverEmail
      ? { id: assignedVendorDriverId, name: initialDriverName, email: initialDriverEmail, phone: initialDriverPhone, relay: initialRelayAddress }
      : null,
  )
  const [st, setSt] = useState<VendorDriverState>(state)
  const [choosing, setChoosing] = useState(false)
  const [pick, setPick] = useState<string>('')
  const [adding, setAdding] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [alsoAssign, setAlsoAssign] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const canAssign = ASSIGNABLE.includes(status) && !readOnly
  const sorted = [...roster].sort((a, b) => Number(b.trainedOnThisUnit) - Number(a.trainedOnThisUnit) || Number(!!b.profileCompletedAt) - Number(!!a.profileCompletedAt))
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  async function post(url: string, body: unknown) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.ok === false) throw new Error(j.error ?? 'That didn’t go through.')
    return j
  }

  function applyAssignment(j: { driverName: string; relayAddress: string; driverMailed: boolean; productionMailed: number }, d: RosterDriverRow | null, id: string) {
    setAssigned({ id, name: j.driverName, email: d?.email ?? '', phone: d?.phone ?? null, relay: j.relayAddress })
    setSt({ driverPageSent: true, driverViewedAt: null, driverAck: null, hours: { total: 0, days: 0 } })
    setChoosing(false)
    setNote(
      j.driverMailed
        ? `${j.driverName} has been sent their page for this job${j.productionMailed ? ', and the production has been told who is coming' : ''}.`
        : `${j.driverName} is assigned. We couldn’t email them just now — SirReel will make sure they get their page.`,
    )
  }

  async function assign(id: string) {
    if (readOnly || !id) return
    setBusy('assign'); setError(null); setNote(null)
    try {
      const j = await post(`/api/public/vendor/${token}/driver`, { vendorDriverId: id })
      applyAssignment(j, roster.find((d) => d.id === id) ?? null, id)
    } catch (e) { setError(e instanceof Error ? e.message : 'request failed') } finally { setBusy(null) }
  }

  async function add() {
    if (readOnly) return
    setBusy('add'); setError(null); setNote(null)
    try {
      const j = await post(`/api/public/vendor/${token}/drivers`, { email: newEmail, name: newName, assign: alsoAssign && canAssign })
      setRoster(j.roster)
      if (j.assignment) applyAssignment(j.assignment, (j.roster as RosterDriverRow[]).find((d) => d.id === j.driverId) ?? null, j.driverId)
      else setNote(j.invited ? `${newEmail.trim()} has been sent a link to complete their profile.` : `Added. We couldn’t email ${newEmail.trim()} just now — try Resend in a moment.`)
      setNewEmail(''); setNewName(''); setAdding(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'request failed') } finally { setBusy(null) }
  }

  async function resend(d: RosterDriverRow) {
    if (readOnly) return
    setBusy(`resend:${d.id}`); setError(null); setNote(null)
    try {
      const j = await post(`/api/public/vendor/${token}/drivers`, { email: d.email, assign: false })
      setRoster(j.roster)
      setNote(j.invited ? `Profile link re-sent to ${d.email}.` : `We couldn’t email ${d.email} just now.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'request failed') } finally { setBusy(null) }
  }

  const eyebrow = 'text-[12px] font-semibold tracking-[0.16em] uppercase text-[#8b857a]'
  const field = 'w-full border border-[#e4dfd4] rounded-lg px-3 py-2.5 text-[16px] bg-white focus:outline-none focus:border-[#c39a3f]'
  const label = 'block text-[12px] font-semibold tracking-[0.1em] uppercase text-[#8b857a] mb-1.5'
  const primary = 'inline-flex min-h-[44px] items-center rounded-full bg-amber-600 hover:bg-amber-500 text-white px-5 text-[14px] font-bold disabled:opacity-50'
  const quiet = 'min-h-[40px] px-2 text-[13px] font-semibold text-[#a37f2c] hover:text-[#8a6a22] disabled:opacity-50'

  const profileChip = (d: RosterDriverRow) =>
    d.profileCompletedAt
      ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#eef6f1] text-[#2f7d5d]">Profile complete</span>
      : d.profileViewedAt
        ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#fbf3e2] text-[#a37f2c]">Started profile</span>
        : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#f1ede4] text-[#5a554c]">Link sent</span>

  return (
    <div className="mt-6 rounded-[14px] border border-[#e4dfd4] bg-white p-5">
      {/* ── This job's driver ─────────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className={eyebrow} style={{ fontFamily: 'Archivo, sans-serif' }}>Driver for this job</div>
        {assigned && !choosing && canAssign && (
          <button onClick={() => { setChoosing(true); setPick(assigned.id ?? '') }} className={`${quiet} -mr-2`}>Change</button>
        )}
      </div>

      {error && <div className="mb-3 text-[13px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{error}</div>}
      {note && <div className="mb-3 text-[13px] text-[#2f7d5d] bg-[#eef6f1] border border-[#cfe5d8] rounded px-3 py-2">{note}</div>}

      {assigned && !choosing ? (
        <>
          <p className="text-[16px] font-semibold text-[#0c0c0d]">{assigned.name}</p>
          <p className="text-[14px] text-[#5a554c]">{assigned.email}{assigned.phone ? ` · ${assigned.phone}` : ''}</p>
          <ul className="mt-3 space-y-1 text-[13px] text-[#3a362f]">
            <li>
              {st.driverPageSent
                ? st.driverViewedAt ? <>Opened their job page {fmt(st.driverViewedAt)}.</> : <>Sent their job page — not opened yet.</>
                : <>Job page not sent yet.</>}
            </li>
            <li>
              {st.driverAck
                ? st.driverAck.stale
                  ? <span className="text-[#a37f2c]">Confirmed an earlier version of the location/call time — waiting on them to re-confirm.</span>
                  : <span className="text-[#2f7d5d]">Confirmed the location and call time {fmt(st.driverAck.at)}.</span>
                : <span>Has not yet confirmed the location and call time.</span>}
            </li>
            {st.hours.days > 0 && <li>Logged <strong>{st.hours.total} hrs</strong> over {st.hours.days} {st.hours.days === 1 ? 'day' : 'days'} — detail below.</li>}
          </ul>
          {assigned.relay && (
            <div className="mt-4 rounded-[12px] border border-[#e4dfd4] bg-[#faf7f0] p-4">
              <div className={label}>Their address for this job</div>
              <div className="flex items-center gap-2">
                <input readOnly value={assigned.relay} onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 border border-[#e4dfd4] rounded px-2 py-2 text-[13px] font-mono bg-white text-[#3a362f]" />
                <button onClick={async () => { await navigator.clipboard.writeText(assigned.relay!); setCopied(true); setTimeout(() => setCopied(false), 1800) }}
                  className="min-h-[40px] px-3 text-[13px] rounded border border-[#e4dfd4] text-[#3a362f] hover:bg-white shrink-0">
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-2.5 text-[13px] text-[#5a554c] leading-relaxed">
                Anything the production emails here lands in {assigned.name}&rsquo;s inbox and a reply goes back through us. Their job page shows the location and call time and is where they confirm and log hours.
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          {!assigned && <p className="text-[14px] text-[#5a554c] mb-3">No driver on this job yet.{roster.length === 0 ? ' Add your first driver below.' : ' Pick one from your drivers.'}</p>}
          {roster.length > 0 && (
            <div className="rounded-[12px] border border-[#e4dfd4] overflow-hidden">
              {sorted.map((d, i) => (
                <label key={d.id} className={`flex items-start gap-3 px-3 py-3 cursor-pointer ${i ? 'border-t border-[#efe9dd]' : ''} ${pick === d.id ? 'bg-[#fbf7ec]' : 'bg-white'}`}>
                  <input type="radio" name="pick" value={d.id} checked={pick === d.id} onChange={() => setPick(d.id)} disabled={!canAssign} className="mt-1 accent-amber-600 w-4 h-4" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-[#0c0c0d]">{d.name}</span>
                    <span className="block text-[13px] text-[#5a554c] truncate">{d.email}{d.phone ? ` · ${d.phone}` : ''}</span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      {profileChip(d)}
                      {d.licenseFront && d.licenseBack && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#eef6f1] text-[#2f7d5d]">Licence on file</span>}
                      {d.trainedOnThisUnit && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#eef6f1] text-[#2f7d5d]">Trained on {unitName}</span>}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {roster.length > 0 && canAssign && (
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <button onClick={() => assign(pick)} disabled={!pick || busy !== null} className={primary} style={{ fontFamily: 'Archivo, sans-serif' }}>
                {busy === 'assign' ? 'Assigning…' : 'Assign to this job'}
              </button>
              {assigned && <button onClick={() => setChoosing(false)} className="min-h-[40px] text-[13px] text-[#8b857a] hover:text-[#3a362f]">Cancel</button>}
            </div>
          )}
        </>
      )}

      {/* ── Your drivers (roster) ─────────────────────────────────────────── */}
      <div className="mt-6 pt-5 border-t border-[#efe9dd]">
        <div className="flex items-baseline justify-between gap-3">
          <div className={eyebrow} style={{ fontFamily: 'Archivo, sans-serif' }}>Your drivers</div>
          {!adding && !readOnly && <button onClick={() => setAdding(true)} className={`${quiet} -mr-2`}>+ Add a driver</button>}
        </div>

        {adding && (
          <div className="mt-3 rounded-[12px] border border-[#e4dfd4] bg-[#faf7f0] p-4">
            <p className="text-[14px] text-[#5a554c] leading-relaxed mb-3">
              Enter their email. We send them a link to fill in their name, phone, a photo of their licence, and which of your units they&rsquo;re trained to drive.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={label}>Driver email</label>
                <input type="email" inputMode="email" autoComplete="off" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className={field} placeholder="driver@example.com" />
              </div>
              <div>
                <label className={label}>Name <span className="normal-case tracking-normal font-normal">(optional)</span></label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} className={field} placeholder="If you know it" />
              </div>
            </div>
            {canAssign && (
              <label className="mt-3 flex items-center gap-2 text-[14px] text-[#3a362f] cursor-pointer">
                <input type="checkbox" checked={alsoAssign} onChange={(e) => setAlsoAssign(e.target.checked)} className="accent-amber-600 w-4 h-4" />
                Also assign them to this job
              </label>
            )}
            <div className="mt-4 flex items-center gap-4 flex-wrap">
              <button onClick={add} disabled={busy !== null || !newEmail.trim()} className={primary} style={{ fontFamily: 'Archivo, sans-serif' }}>
                {busy === 'add' ? 'Sending…' : alsoAssign && canAssign ? 'Add & assign' : 'Add & send link'}
              </button>
              <button onClick={() => setAdding(false)} className="min-h-[40px] text-[13px] text-[#8b857a] hover:text-[#3a362f]">Cancel</button>
            </div>
          </div>
        )}

        {roster.length === 0 && !adding ? (
          <p className="mt-2 text-[14px] text-[#5a554c]">No drivers on file yet. Add one and they fill in their own details.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[#efe9dd]">
            {roster.map((d) => (
              <li key={d.id} className="py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-[#0c0c0d]">{d.name}{assigned?.id === d.id && <span className="ml-2 text-[11px] font-semibold text-[#a37f2c]">on this job</span>}</div>
                  <div className="text-[12px] text-[#8b857a] truncate">
                    {d.email}
                    {d.trainedVehicles.length > 0 && <> · trained on {d.trainedVehicles.map((v) => v.name).join(', ')}</>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {profileChip(d)}
                    {d.licenseFront && d.licenseBack ? (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#eef6f1] text-[#2f7d5d]">
                        Licence:{' '}
                        <a href={`/api/public/vendor/${token}/drivers/${d.id}/license/front`} target="_blank" rel="noreferrer" className="underline">front</a>
                        {' / '}
                        <a href={`/api/public/vendor/${token}/drivers/${d.id}/license/back`} target="_blank" rel="noreferrer" className="underline">back</a>
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#fbf3e2] text-[#a37f2c]">Licence missing</span>
                    )}
                  </div>
                </div>
                {!d.profileCompletedAt && !readOnly && (
                  <button onClick={() => resend(d)} disabled={busy !== null} className={`${quiet} shrink-0`}>
                    {busy === `resend:${d.id}` ? 'Sending…' : 'Resend link'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
