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
 *
 * 2026-09-07 restyle: on the yard kit. Logic untouched; the driver rows
 * are 16px / 52px targets, the verdict is a card in the good/warn tones,
 * and the hand-over button is pinned to the bottom of the phone.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, KeyRound, CheckCircle2, Search, UserPlus, ExternalLink, Copy, RefreshCw } from 'lucide-react'
import { evaluateLicenseGate, type LicenseGateResult } from '@/lib/drivers/licenseGate'
import { YardCard, YardOutcome, YardSectionTitle, yardBtnSecondary } from './yard-ui'
import { StickyBar, YardAlert, YardNote, yardInput, yardSubmit } from './YardControls'

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

const smallBtn =
  'inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-xl px-3.5 text-[14px] font-semibold'

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
      <YardOutcome
        icon={done.overridden ? AlertTriangle : KeyRound}
        tone={done.overridden ? 'warn' : 'good'}
        title={`Handed over to ${done.name}`}
      >
        <p>
          {done.overridden
            ? 'Recorded as a licence-gate override — the reason is on the checkout.'
            : 'Licence on file and checked at handover.'}
        </p>
        <p className="text-zinc-400 text-[13px]">
          {done.jobRecorded
            ? 'Added to the job’s driver list — the office and the client can see who took it.'
            : 'Handover recorded. The job’s driver list did not update — mention it to the office.'}
        </p>
      </YardOutcome>
    )
  }

  const verdictLabel = (g: LicenseGateResult) =>
    g.ok ? 'OK' : g.code === 'EXPIRED' ? 'Expired' : g.code === 'NO_LICENSE' ? 'No licence' : 'Unchecked'
  const verdictChip = (g: LicenseGateResult) =>
    g.ok
      ? 'bg-emerald-500/15 text-emerald-300'
      : g.code === 'EXPIRED'
        ? 'bg-rose-500/15 text-rose-300'
        : 'bg-yellow-500/15 text-yellow-300'

  return (
    <div className="space-y-4">
      {assignedDriver && (
        <YardCard tone="info">
          <div className="text-[11px] font-bold uppercase tracking-wide text-amber-300">Currently assigned</div>
          <div className="mt-1 text-white text-[16px] font-semibold">{assignedDriver.name}</div>
          <div className="text-[13px] text-zinc-300">
            {assignedDriver.licenseVerifiedAtHandover
              ? 'Licence was checked at handover'
              : 'Handed over WITHOUT a checked licence'}
          </div>
          <div className="mt-1.5 text-[12px] text-zinc-500">Selecting someone below replaces this.</div>
        </YardCard>
      )}

      {error && <YardAlert tone="bad">{error}</YardAlert>}
      {matched && (
        <YardAlert tone="info">{matched} already has a file here — selected it, licence and all.</YardAlert>
      )}

      {/* Driver picker */}
      <YardCard>
        <YardSectionTitle>Who is taking it?</YardSectionTitle>
        <div className="relative">
          <Search size={16} aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setSelectedId(null); setLink(null) }}
            placeholder="Search drivers…"
            className={`${yardInput} pl-10`}
          />
        </div>
        {drivers === null ? (
          <p className="mt-3 text-[13px] text-zinc-500">Loading drivers…</p>
        ) : (
          <div className="mt-2 -mx-1">
            {filtered.map((d) => {
              const g = evaluateLicenseGate(toGateInput(d))
              const active = d.id === selectedId
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => { setSelectedId(d.id); setLink(null); setOverrideOpen(false) }}
                  aria-pressed={active}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 min-h-[52px] py-2 text-left transition-colors ${
                    active ? 'bg-amber-600/20 ring-1 ring-amber-500' : 'active:bg-zinc-800'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[16px] text-white font-medium">{d.name}</span>
                    <span className="block truncate text-[13px] text-zinc-400">
                      {d.companyName || 'Guest driver'}{d.phone ? ` · ${d.phone}` : ''}
                    </span>
                  </span>
                  <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${verdictChip(g)}`}>
                    {verdictLabel(g)}
                  </span>
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-[13px] text-zinc-500">No match.</p>
            )}
          </div>
        )}

        {!addOpen ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="mt-2 min-h-[44px] inline-flex items-center gap-1.5 text-[14px] font-semibold text-amber-400 active:text-amber-300"
          >
            <UserPlus size={15} aria-hidden />
            Driver isn&rsquo;t listed
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First" className={yardInput} />
              <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last" className={yardInput} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input value={addEmail} onChange={(e) => setAddEmail(e.target.value)} type="email" placeholder="Email" className={yardInput} />
              <input value={addPhone} onChange={(e) => setAddPhone(e.target.value)} type="tel" placeholder="Phone" className={yardInput} />
            </div>
            <button
              type="button"
              onClick={addDriver}
              disabled={busy === 'add' || !first.trim() || !last.trim()}
              className={`${smallBtn} w-full bg-zinc-100 text-zinc-900 disabled:opacity-40`}
            >
              {busy === 'add' ? 'Adding…' : 'Add driver'}
            </button>
            {/* Email is how a returning driver lands back on their own file
                instead of becoming a second, licence-less copy. */}
            <YardNote>
              Ask for their email — if they&rsquo;ve driven for us before, it finds their licence instead of
              starting a blank file.
            </YardNote>
          </div>
        )}
      </YardCard>

      {/* Verdict + the way out of it */}
      {selected && gate && (
        <YardCard tone={gate.ok ? 'good' : 'warn'}>
          <div className="flex items-start gap-3">
            <span className="leading-none mt-0.5">
              {gate.ok
                ? <CheckCircle2 size={22} aria-hidden className="text-emerald-400" />
                : <AlertTriangle size={22} aria-hidden className="text-yellow-400" />}
            </span>
            <div className="min-w-0">
              <div className="text-[16px] font-semibold text-white">
                {gate.ok ? 'Cleared to hand over' : 'Blocked'}
              </div>
              <p className="mt-0.5 text-[14px] text-zinc-200 leading-snug">{gate.message}</p>
              {selected.licenseExpiry && (
                <p className="mt-1 text-[13px] text-zinc-400">
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
                  <button
                    type="button"
                    onClick={sendLink}
                    disabled={busy === 'link'}
                    className={`${smallBtn} w-full bg-amber-600 text-white active:bg-amber-500 disabled:opacity-40`}
                  >
                    {busy === 'link' ? 'Creating…' : 'Get upload link'}
                  </button>
                  {link && (
                    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                      <p className="text-[13px] text-zinc-400">Open this on the tablet and photograph their licence, or text it to them.</p>
                      <p className="mt-1 break-all font-mono text-[12px] text-zinc-300">{link}</p>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <a href={link} target="_blank" rel="noopener noreferrer" className={`${smallBtn} bg-zinc-100 text-zinc-900`}>
                          <ExternalLink size={14} aria-hidden />
                          Open
                        </a>
                        <button type="button" onClick={() => navigator.clipboard?.writeText(link)} className={yardBtnSecondary}>
                          <Copy size={14} aria-hidden />
                          Copy
                        </button>
                        <button type="button" onClick={() => void load()} className={yardBtnSecondary}>
                          <RefreshCw size={14} aria-hidden />
                          Refresh
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {gate.code === 'NOT_CHECKED' && (
                <div className="flex flex-wrap gap-2">
                  <a href={`/api/drivers/${selected.id}/license/front`} target="_blank" rel="noopener noreferrer" className={yardBtnSecondary}>
                    View front
                    <ExternalLink size={13} aria-hidden />
                  </a>
                  {selected.hasBack && (
                    <a href={`/api/drivers/${selected.id}/license/back`} target="_blank" rel="noopener noreferrer" className={yardBtnSecondary}>
                      View back
                      <ExternalLink size={13} aria-hidden />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={markChecked}
                    disabled={busy === 'check'}
                    className={`${smallBtn} flex-1 bg-amber-600 text-white active:bg-amber-500 disabled:opacity-40`}
                  >
                    {busy === 'check' ? 'Saving…' : 'Looks good — mark checked'}
                  </button>
                </div>
              )}
              {gate.code === 'EXPIRED' && (
                <button
                  type="button"
                  onClick={sendLink}
                  disabled={busy === 'link'}
                  className={`${yardBtnSecondary} w-full disabled:opacity-40`}
                >
                  {busy === 'link' ? 'Creating…' : 'Get link for a current licence'}
                </button>
              )}
            </div>
          )}
        </YardCard>
      )}

      {/* Override path — opened from the sticky bar, lands in the flow. */}
      {selected && gate && !gate.ok && overrideOpen && (
        <YardCard tone="warn">
          <p className="text-[13px] text-yellow-100/80 leading-snug">
            This is recorded on the checkout with your name. The licence stays marked unverified — an override
            doesn&rsquo;t make it good.
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Why is this going out anyway?"
            className={`${yardInput} mt-2`}
          />
          <button
            type="button"
            onClick={() => handOver(reason.trim())}
            disabled={reason.trim().length < 5 || busy === 'submit'}
            className={`${smallBtn} mt-2 w-full bg-yellow-600 text-white active:bg-yellow-500 disabled:opacity-40`}
          >
            {busy === 'submit' ? 'Recording…' : 'Override and hand over'}
          </button>
        </YardCard>
      )}

      {/* Hand over */}
      {selected && gate && (
        <StickyBar
          status={
            gate.ok ? (
              <YardNote tone="good">Licence checked — ready to go.</YardNote>
            ) : !overrideOpen ? (
              <button
                type="button"
                onClick={() => setOverrideOpen(true)}
                className="min-h-[36px] text-[13px] text-zinc-400 underline active:text-white"
              >
                Override and hand over anyway
              </button>
            ) : (
              <YardNote tone="warn">Override form is above — give a reason.</YardNote>
            )
          }
        >
          <button
            type="button"
            onClick={() => handOver()}
            disabled={!gate.ok || busy === 'submit'}
            className={yardSubmit}
          >
            <span className="inline-flex items-center gap-2">
              <KeyRound size={18} aria-hidden />
              {busy === 'submit' ? 'Handing over…' : `Hand over to ${selected.name}`}
            </span>
          </button>
        </StickyBar>
      )}
    </div>
  )
}
