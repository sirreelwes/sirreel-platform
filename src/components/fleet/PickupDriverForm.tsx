'use client'

/**
 * PickupDriverForm — pick the driver, see the licence verdict, hand over.
 *
 * The verdict shown here comes from the SAME pure function the server
 * enforces with (evaluateLicenseGate), so the screen can never promise
 * something the API will then refuse. The server is still the authority;
 * this is a preview, not a substitute.
 *
 * Every blocker is actionable in place — send/open the upload link, mark
 * a licence checked, add a driver who isn't in the system. A rep holding
 * a truck at the gate needs the fix, not just the refusal.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, KeyRound, CheckCircle2 } from 'lucide-react';
import { evaluateLicenseGate, type LicenseGateResult } from '@/lib/drivers/licenseGate'

interface DriverRow {
  id: string
  name: string
  phone: string | null
  companyName: string | null
  licenseState: string | null
  licenseExpiry: string | null
  licenseExpired: boolean | null
  licenseVerified: boolean
  hasFront: boolean
  hasBack: boolean
}

interface Props {
  checkoutId: string
  assignedDriver: { id: string; name: string; licenseVerifiedAtHandover: boolean } | null
}

/** Shape a roster row into what the shared gate expects. */
function toGateInput(d: DriverRow) {
  return {
    licenseFrontUrl: d.hasFront ? 'present' : null,
    licenseBackUrl: d.hasBack ? 'present' : null,
    licenseExpiry: d.licenseExpiry,
    licenseExpired: d.licenseExpired,
    licenseVerified: d.licenseVerified,
  }
}

export function PickupDriverForm({ checkoutId, assignedDriver }: Props) {
  const [drivers, setDrivers] = useState<DriverRow[] | null>(null)
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [done, setDone] = useState<{ name: string; overridden: boolean; jobRecorded: boolean } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [matched, setMatched] = useState<string | null>(null)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addPhone, setAddPhone] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/drivers/list')
    if (!res.ok) { setError('Could not load drivers.'); return }
    const j = await res.json()
    setDrivers(j.drivers ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  const selected = useMemo(
    () => drivers?.find((d) => d.id === selectedId) ?? null,
    [drivers, selectedId],
  )
  const gate: LicenseGateResult | null = useMemo(
    () => (selected ? evaluateLicenseGate(toGateInput(selected)) : null),
    [selected],
  )

  const filtered = useMemo(() => {
    if (!drivers) return []
    const needle = q.trim().toLowerCase()
    if (!needle) return drivers.slice(0, 8)
    return drivers.filter((d) => d.name.toLowerCase().includes(needle)).slice(0, 8)
  }, [drivers, q])

  async function addDriver() {
    if (!first.trim() || !last.trim()) return
    setBusy('add'); setError(null)
    try {
      const res = await fetch('/api/drivers', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firstName: first, lastName: last,
          email: addEmail.trim() || undefined,
          phone: addPhone.trim() || undefined,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not add driver')
      await load()
      setSelectedId(j.driver.id)
      // An email that matched an existing file is the good outcome, not a
      // silent one — it usually means a licence is already on record.
      if (j.matchedExisting) {
        setError(null)
        setMatched(`${j.driver.firstName} ${j.driver.lastName}`.trim())
      }
      setAddOpen(false); setFirst(''); setLast(''); setAddEmail(''); setAddPhone(''); setQ('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add driver') }
    finally { setBusy(null) }
  }

  async function sendLink() {
    if (!selected) return
    setBusy('link'); setError(null)
    try {
      const res = await fetch(`/api/drivers/${selected.id}/invite`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not create link')
      setLink(j.url)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create link') }
    finally { setBusy(null) }
  }

  async function markChecked() {
    if (!selected) return
    setBusy('check'); setError(null)
    try {
      await fetch(`/api/drivers/${selected.id}/verify-license`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verified: true }),
      })
      await load()
    } finally { setBusy(null) }
  }

  async function handOver(withReason?: string) {
    if (!selected) return
    setBusy('submit'); setError(null)
    try {
      const res = await fetch(`/api/fleet/checkouts/${checkoutId}/driver`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(withReason ? { driverId: selected.id, overrideReason: withReason } : { driverId: selected.id }),
      })
      const j = await res.json()
      if (!res.ok) { setError(j.error || 'Handover blocked.'); return }
      setDone({ name: j.driverName, overridden: !!j.overridden, jobRecorded: j.jobRecorded !== false })
    } catch { setError('Something went wrong. Try again.') }
    finally { setBusy(null) }
  }

  if (done) {
    return (
      <div className={`rounded-xl border p-5 text-center ${done.overridden ? 'border-amber-600 bg-amber-950/40' : 'border-emerald-700 bg-emerald-950/40'}`}>
        <div className="mb-2 flex justify-center">
          {done.overridden
            ? <AlertTriangle size={30} aria-hidden className="text-amber-500" />
            : <KeyRound size={30} aria-hidden className="text-emerald-500" />}
        </div>
        <p className="text-white font-semibold">Handed over to {done.name}</p>
        <p className="mt-1 text-sm text-zinc-300">
          {done.overridden
            ? 'Recorded as a licence-gate override — the reason is on the checkout.'
            : 'Licence on file and checked at handover.'}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          {done.jobRecorded
            ? 'Added to the job\u2019s driver list — the office and the client can see who took it.'
            : 'Handover recorded. The job\u2019s driver list did not update — mention it to the office.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {assignedDriver && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-800 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">Currently assigned</div>
          <div className="mt-0.5 text-white font-semibold">{assignedDriver.name}</div>
          <div className="text-xs text-zinc-400">
            {assignedDriver.licenseVerifiedAtHandover
              ? 'Licence was checked at handover'
              : 'Handed over WITHOUT a checked licence'}
          </div>
          <div className="mt-1.5 text-xs text-zinc-500">Selecting someone below replaces this.</div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-200">{error}</div>
      )}

      {matched && (
        <div className="rounded-xl border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          {matched} already has a file here — selected it, licence and all.
        </div>
      )}

      {/* Driver picker */}
      <div className="rounded-xl border border-zinc-700 bg-zinc-800 p-4">
        <label className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">Who is taking it?</label>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setSelectedId(null); setLink(null) }}
          placeholder="Search drivers…"
          className="mt-1.5 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2.5 text-[15px] text-white placeholder:text-zinc-500"
        />
        {drivers === null ? (
          <p className="mt-3 text-xs text-zinc-500">Loading drivers…</p>
        ) : (
          <div className="mt-2 space-y-1">
            {filtered.map((d) => {
              const g = evaluateLicenseGate(toGateInput(d))
              const active = d.id === selectedId
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => { setSelectedId(d.id); setLink(null); setOverrideOpen(false) }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    active ? 'bg-amber-600/20 ring-1 ring-amber-500' : 'hover:bg-zinc-700/60'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] text-white">{d.name}</span>
                    <span className="block truncate text-xs text-zinc-400">
                      {d.companyName || 'Guest driver'}{d.phone ? ` · ${d.phone}` : ''}
                    </span>
                  </span>
                  <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    g.ok ? 'bg-emerald-500/15 text-emerald-300'
                      : g.code === 'EXPIRED' ? 'bg-rose-500/15 text-rose-300'
                      : 'bg-amber-500/15 text-amber-300'
                  }`}>
                    {g.ok ? 'OK' : g.code === 'EXPIRED' ? 'Expired' : g.code === 'NO_LICENSE' ? 'No licence' : 'Unchecked'}
                  </span>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="px-1 py-2 text-xs text-zinc-500">No match.</p>
            )}
          </div>
        )}

        {!addOpen ? (
          <button type="button" onClick={() => setAddOpen(true)}
            className="mt-2 text-xs font-semibold text-amber-500 hover:text-amber-400">
            + Driver isn&rsquo;t listed
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First"
                className="min-w-0 flex-1 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
              <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last"
                className="min-w-0 flex-1 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
            </div>
            <div className="flex flex-wrap gap-2">
              <input value={addEmail} onChange={(e) => setAddEmail(e.target.value)} type="email" placeholder="Email"
                className="min-w-0 flex-1 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
              <input value={addPhone} onChange={(e) => setAddPhone(e.target.value)} placeholder="Phone"
                className="min-w-0 flex-1 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500" />
            </div>
            <button type="button" onClick={addDriver} disabled={busy === 'add' || !first.trim() || !last.trim()}
              className="w-full rounded-lg bg-zinc-200 px-3 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40">
              {busy === 'add' ? 'Adding…' : 'Add'}
            </button>
            {/* Email is how a returning driver lands back on their own file
                instead of becoming a second, licence-less copy. */}
            <p className="text-[11px] leading-snug text-zinc-500">
              Ask for their email — if they&rsquo;ve driven for us before, it finds their
              licence instead of starting a blank file.
            </p>
          </div>
        )}
      </div>

      {/* Verdict + the way out of it */}
      {selected && gate && (
        <div className={`rounded-xl border p-4 ${
          gate.ok ? 'border-emerald-700 bg-emerald-950/30' : 'border-amber-700 bg-amber-950/25'
        }`}>
          <div className="flex items-start gap-2.5">
            <span className="leading-none">
              {gate.ok
                ? <CheckCircle2 size={18} aria-hidden className="text-emerald-500" />
                : <AlertTriangle size={18} aria-hidden className="text-amber-500" />}
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-white">
                {gate.ok ? 'Cleared to hand over' : 'Blocked'}
              </div>
              <p className="mt-0.5 text-sm text-zinc-300">{gate.message}</p>
              {selected.licenseExpiry && (
                <p className="mt-1 text-xs text-zinc-400">
                  {selected.licenseState || '—'} · expires{' '}
                  {new Date(selected.licenseExpiry).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
                  })}
                </p>
              )}
            </div>
          </div>

          {!gate.ok && (
            <div className="mt-3 space-y-2">
              {gate.code === 'NO_LICENSE' && (
                <>
                  <button type="button" onClick={sendLink} disabled={busy === 'link'}
                    className="w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-40">
                    {busy === 'link' ? 'Creating…' : 'Get upload link'}
                  </button>
                  {link && (
                    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3">
                      <p className="text-xs text-zinc-400">Open this on the tablet and photograph their licence, or text it to them.</p>
                      <p className="mt-1 break-all font-mono text-[11px] text-zinc-300">{link}</p>
                      <div className="mt-2 flex gap-2">
                        <a href={link} target="_blank" rel="noopener noreferrer"
                          className="rounded-lg bg-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-900">Open here ↗</a>
                        <button type="button" onClick={() => navigator.clipboard?.writeText(link)}
                          className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-semibold text-zinc-200">Copy</button>
                        <button type="button" onClick={() => void load()}
                          className="rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-semibold text-zinc-200">Refresh</button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {gate.code === 'NOT_CHECKED' && (
                <div className="flex flex-wrap gap-2">
                  <a href={`/api/drivers/${selected.id}/license/front`} target="_blank" rel="noopener noreferrer"
                    className="rounded-lg border border-zinc-600 px-3 py-2 text-xs font-semibold text-zinc-200">View front ↗</a>
                  {selected.hasBack && (
                    <a href={`/api/drivers/${selected.id}/license/back`} target="_blank" rel="noopener noreferrer"
                      className="rounded-lg border border-zinc-600 px-3 py-2 text-xs font-semibold text-zinc-200">View back ↗</a>
                  )}
                  <button type="button" onClick={markChecked} disabled={busy === 'check'}
                    className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-40">
                    {busy === 'check' ? 'Saving…' : 'Looks good — mark checked'}
                  </button>
                </div>
              )}
              {gate.code === 'EXPIRED' && (
                <button type="button" onClick={sendLink} disabled={busy === 'link'}
                  className="w-full rounded-lg border border-zinc-600 px-4 py-2.5 text-sm font-semibold text-zinc-200 disabled:opacity-40">
                  {busy === 'link' ? 'Creating…' : 'Get link for a current licence'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Hand over */}
      {selected && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => handOver()}
            disabled={!gate?.ok || busy === 'submit'}
            className="w-full rounded-xl bg-emerald-600 px-4 py-3.5 text-[15px] font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {busy === 'submit' ? 'Handing over…' : `Hand over to ${selected.name}`}
          </button>

          {!gate?.ok && (
            !overrideOpen ? (
              <button type="button" onClick={() => setOverrideOpen(true)}
                className="w-full text-center text-xs text-zinc-500 underline hover:text-zinc-300">
                Override and hand over anyway
              </button>
            ) : (
              <div className="rounded-xl border border-amber-700 bg-amber-950/25 p-3">
                <p className="text-xs text-zinc-300">
                  This is recorded on the checkout with your name. The licence stays marked
                  unverified — an override doesn&rsquo;t make it good.
                </p>
                <textarea
                  value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                  placeholder="Why is this going out anyway?"
                  className="mt-2 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500"
                />
                <button type="button" onClick={() => handOver(reason.trim())}
                  disabled={reason.trim().length < 5 || busy === 'submit'}
                  className="mt-2 w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-40">
                  {busy === 'submit' ? 'Recording…' : 'Override and hand over'}
                </button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
