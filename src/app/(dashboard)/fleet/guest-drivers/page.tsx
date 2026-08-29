'use client'

/**
 * /fleet/guest-drivers — the driver roster. Replaces the "Coming soon"
 * stub with the real thing: who has driven, what licence is on file, and
 * whether a person has actually looked at it.
 *
 * The three states that matter to a rep at the counter, in order of how
 * loudly they read: EXPIRED (the card's printed date has passed), NO
 * LICENCE (nothing on file), and ON FILE but not yet checked by a human.
 * "Verified" here means a staff member opened the images and accepted
 * them — never that a DMV confirmed anything. See readLicense.ts.
 */

import { useCallback, useEffect, useState } from 'react'
import { UserPlus } from 'lucide-react'

interface DriverRow {
  id: string
  name: string
  phone: string | null
  email: string | null
  type: 'INTERNAL' | 'EXTERNAL'
  isActive: boolean
  flagged: boolean
  flagReason: string | null
  totalCheckouts: number
  damageIncidents: number
  companyName: string | null
  licenseState: string | null
  licenseExpiry: string | null
  licenseExpired: boolean | null
  licenseClass: string | null
  licenseUploadedAt: string | null
  hasFront: boolean
  hasBack: boolean
  licenseVerified: boolean
  licenseVerifiedAt: string | null
  hasLiveLink: boolean
}

// Licence dates are date-only values stored at UTC midnight. Formatting
// them in local time renders the PREVIOUS day west of UTC — a card reading
// EXP 03/14 showed as Mar 13, which is exactly the kind of off-by-one that
// makes a rep at the counter distrust the whole screen. Force UTC.
const fmtDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      })
    : '—'

export default function GuestDriversPage() {
  const [drivers, setDrivers] = useState<DriverRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [phone, setPhone] = useState('')
  const [link, setLink] = useState<{ id: string; url: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/drivers/list')
    if (!res.ok) { setErr('Could not load drivers.'); return }
    const j = await res.json()
    setDrivers(j.drivers ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  async function addDriver() {
    if (!first.trim() || !last.trim()) return
    setBusy('add')
    try {
      const res = await fetch('/api/drivers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ firstName: first, lastName: last, phone: phone || undefined }),
      })
      if (!res.ok) throw new Error('create failed')
      setFirst(''); setLast(''); setPhone(''); setAdding(false)
      await load()
    } catch { setErr('Could not add that driver.') } finally { setBusy(null) }
  }

  async function makeLink(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/drivers/${id}/invite`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error()
      setLink({ id, url: j.url })
      await load()
    } catch { setErr('Could not create a link.') } finally { setBusy(null) }
  }

  async function setVerified(id: string, verified: boolean) {
    setBusy(id)
    try {
      await fetch(`/api/drivers/${id}/verify-license`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ verified }),
      })
      await load()
    } finally { setBusy(null) }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Drivers</h1>
          <p className="mt-1 text-sm text-gray-500">
            Everyone who takes a vehicle out. Send a link and they photograph their
            license from their phone, or open it on a tablet at pickup.
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-amber-500"
        >
          <UserPlus size={15} /> Add driver
        </button>
      </header>

      {err && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700">{err}</div>}

      {adding && (
        <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap gap-2">
            <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First name"
              className="flex-1 min-w-[140px] rounded-lg border border-gray-300 px-3 py-2 text-[13px]" />
            <input value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last name"
              className="flex-1 min-w-[140px] rounded-lg border border-gray-300 px-3 py-2 text-[13px]" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)"
              className="flex-1 min-w-[140px] rounded-lg border border-gray-300 px-3 py-2 text-[13px]" />
            <button onClick={addDriver} disabled={busy === 'add' || !first.trim() || !last.trim()}
              className="rounded-lg bg-gray-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40">
              {busy === 'add' ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {link && (
        <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div className="text-[12px] font-bold uppercase tracking-wide text-amber-700">Driver link — expires in 14 days</div>
          <div className="mt-1.5 break-all font-mono text-[12px] text-gray-800">{link.url}</div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => navigator.clipboard?.writeText(link.url)}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-500">Copy link</button>
            <button onClick={() => setLink(null)} className="rounded-lg px-3 py-1.5 text-[12px] text-gray-600 hover:bg-amber-100">Dismiss</button>
          </div>
        </div>
      )}

      {drivers === null ? (
        <div className="py-10 text-center text-[13px] text-gray-400">Loading drivers…</div>
      ) : drivers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
          <div className="text-[15px] text-gray-600">No drivers on file yet.</div>
          <div className="mt-1 text-[13px] text-gray-400">Add one, then send them a link to photograph their license.</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5">Driver</th>
                <th className="px-4 py-2.5">License</th>
                <th className="px-4 py-2.5">Images</th>
                <th className="px-4 py-2.5">History</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {drivers.map((d) => (
                <tr key={d.id} className={d.flagged ? 'bg-rose-50/50' : undefined}>
                  <td className="px-4 py-3 align-top">
                    <div className="text-[14px] font-semibold text-gray-900">{d.name}</div>
                    <div className="text-[12px] text-gray-500">
                      {d.companyName || (d.type === 'INTERNAL' ? 'SirReel' : 'Guest driver')}
                      {d.phone && <> · {d.phone}</>}
                    </div>
                    {d.flagged && (
                      <div className="mt-1 text-[11px] font-semibold text-rose-700">⚠ {d.flagReason || 'Flagged'}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <LicenseCell d={d} />
                  </td>
                  <td className="px-4 py-3 align-top">
                    {d.hasFront || d.hasBack ? (
                      <div className="flex gap-2">
                        {d.hasFront && <ImgLink id={d.id} side="front" />}
                        {d.hasBack && <ImgLink id={d.id} side="back" />}
                      </div>
                    ) : (
                      <span className="text-[12px] text-gray-400">None</span>
                    )}
                    {d.licenseUploadedAt && (
                      <div className="mt-1 text-[11px] text-gray-400">added {fmtDate(d.licenseUploadedAt)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-[12px] text-gray-600">
                    {d.totalCheckouts} checkout{d.totalCheckouts === 1 ? '' : 's'}
                    {d.damageIncidents > 0 && (
                      <div className="text-rose-600">{d.damageIncidents} damage</div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-col items-end gap-1.5">
                      <button onClick={() => makeLink(d.id)} disabled={busy === d.id}
                        className="rounded-lg border border-gray-300 px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                        {d.hasLiveLink ? 'New link' : 'Send link'}
                      </button>
                      {(d.hasFront || d.hasBack) && (
                        <button onClick={() => setVerified(d.id, !d.licenseVerified)} disabled={busy === d.id}
                          className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40 ${
                            d.licenseVerified
                              ? 'border border-gray-300 text-gray-600 hover:bg-gray-50'
                              : 'bg-gray-900 text-white hover:bg-gray-800'
                          }`}>
                          {d.licenseVerified ? 'Un-check' : 'Mark checked'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <p className="mt-4 text-[12px] leading-relaxed text-gray-400">
        &ldquo;Checked&rdquo; means a SirReel staff member opened the images and accepted them.
        We read the printed expiry off the card, but nothing here confirms with the DMV
        that a license is currently unsuspended — that would need a motor-vehicle-record service.
      </p>
    </div>
  )
}

function LicenseCell({ d }: { d: DriverRow }) {
  if (!d.hasFront && !d.hasBack) {
    return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">No license</span>
  }
  const expired = d.licenseExpired === true
  return (
    <div>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
        expired ? 'bg-rose-100 text-rose-700'
          : d.licenseVerified ? 'bg-emerald-100 text-emerald-700'
          : 'bg-amber-100 text-amber-700'
      }`}>
        {expired ? 'Expired' : d.licenseVerified ? 'Checked' : 'Needs check'}
      </span>
      <div className="mt-1 text-[12px] text-gray-600">
        {d.licenseState || '—'}{d.licenseClass ? ` · Class ${d.licenseClass}` : ''}
        {d.licenseExpiry && <> · exp {fmtDate(d.licenseExpiry)}</>}
      </div>
    </div>
  )
}

function ImgLink({ id, side }: { id: string; side: 'front' | 'back' }) {
  return (
    <a href={`/api/drivers/${id}/license/${side}`} target="_blank" rel="noopener noreferrer"
      className="rounded-lg border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:border-amber-400 hover:text-amber-700">
      {side === 'front' ? 'Front' : 'Back'} ↗
    </a>
  )
}
