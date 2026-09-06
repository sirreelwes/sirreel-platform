'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { hqFetch } from './hqFetch'
import { BTN_DANGER, BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT, LABEL } from './ui'

interface Opt { id: string; name: string }
interface Conflict { source: 'direct' | 'partner'; title: string; startDate: string; endDate: string }

export interface BookingFormValues {
  vehicleId: string
  clientId: string
  title: string
  startDate: string
  endDate: string
  status: 'HOLD' | 'CONFIRMED' | 'OUT' | 'RETURNED' | 'CANCELLED'
  dailyRate: string
  location: string
  callTime: string
  driverName: string
  vendorDriverId: string
  notes: string
}

const STATUS_OPTS: { v: BookingFormValues['status']; label: string }[] = [
  { v: 'HOLD', label: 'Hold' },
  { v: 'CONFIRMED', label: 'Confirmed' },
  { v: 'OUT', label: 'Out' },
  { v: 'RETURNED', label: 'Returned' },
  { v: 'CANCELLED', label: 'Cancelled' },
]

export function BookingForm({
  base,
  token,
  units,
  clients,
  drivers,
  bookingId,
  initial,
}: {
  base: string
  token: string
  units: Opt[]
  clients: Opt[]
  /** The partner's roster. Picking one emails them their page. */
  drivers: Opt[]
  bookingId?: string
  initial?: Partial<BookingFormValues>
}) {
  const router = useRouter()
  const [v, setV] = useState<BookingFormValues>({
    vehicleId: initial?.vehicleId ?? units[0]?.id ?? '',
    clientId: initial?.clientId ?? '',
    title: initial?.title ?? '',
    startDate: initial?.startDate ?? '',
    endDate: initial?.endDate ?? '',
    status: initial?.status ?? 'HOLD',
    dailyRate: initial?.dailyRate ?? '',
    location: initial?.location ?? '',
    callTime: initial?.callTime ?? '',
    driverName: initial?.driverName ?? '',
    vendorDriverId: initial?.vendorDriverId ?? '',
    notes: initial?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null)

  const set = (k: keyof BookingFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const val = e.target.value
    setV((p) => {
      const next = { ...p, [k]: val }
      // A one-day booking is the common case: end follows start until touched.
      if (k === 'startDate' && (!p.endDate || p.endDate < val)) next.endDate = val
      return next
    })
    setConflicts(null)
  }

  async function submit(allowOverlap = false) {
    setBusy(true)
    setError(null)
    const body = { ...v, clientId: v.clientId || null, vendorDriverId: v.vendorDriverId || null, allowOverlap }
    const r = bookingId
      ? await hqFetch(`/api/public/vendor-hq/${token}/bookings/${bookingId}`, 'PATCH', body)
      : await hqFetch<{ id: string }>(`/api/public/vendor-hq/${token}/bookings`, 'POST', body)
    setBusy(false)
    if (!r.ok) {
      if (r.status === 409 && Array.isArray(r.data.conflicts)) {
        setConflicts(r.data.conflicts as Conflict[])
        return
      }
      setError(r.error)
      return
    }
    router.push(`${base}/bookings`)
    router.refresh()
  }

  async function setStatus(status: BookingFormValues['status']) {
    if (!bookingId) return
    setBusy(true)
    setError(null)
    const r = await hqFetch(`/api/public/vendor-hq/${token}/bookings/${bookingId}`, 'PATCH', { status })
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setV((p) => ({ ...p, status }))
    router.refresh()
  }

  const fmt = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

  return (
    <form
      className={`${CARD} p-5 space-y-4`}
      onSubmit={(e) => {
        e.preventDefault()
        void submit(false)
      }}
    >
      {bookingId && (
        <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-[#eef0f3]">
          <span className="text-[12px] font-semibold text-[#6b7280] mr-1">Move it along:</span>
          {v.status === 'HOLD' && <button type="button" disabled={busy} className={BTN_SECONDARY} onClick={() => setStatus('CONFIRMED')}>Confirm</button>}
          {(v.status === 'HOLD' || v.status === 'CONFIRMED') && <button type="button" disabled={busy} className={BTN_SECONDARY} onClick={() => setStatus('OUT')}>Send out</button>}
          {v.status === 'OUT' && <button type="button" disabled={busy} className={BTN_SECONDARY} onClick={() => setStatus('RETURNED')}>Bring back</button>}
          {v.status !== 'CANCELLED' && v.status !== 'RETURNED' && <button type="button" disabled={busy} className={BTN_DANGER} onClick={() => setStatus('CANCELLED')}>Cancel booking</button>}
          {v.status === 'CANCELLED' && <button type="button" disabled={busy} className={BTN_SECONDARY} onClick={() => setStatus('HOLD')}>Reinstate as hold</button>}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className={LABEL}>Show / production</label>
          <input className={INPUT} value={v.title} onChange={set('title')} placeholder="e.g. Untitled Pilot — Warner" required />
        </div>
        <div>
          <label className={LABEL}>Unit</label>
          <select className={INPUT} value={v.vehicleId} onChange={set('vehicleId')} required>
            {units.length === 0 && <option value="">Add a unit to your fleet first</option>}
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL}>Client</label>
          <select className={INPUT} value={v.clientId} onChange={set('clientId')}>
            <option value="">— none yet —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL}>First day</label>
          <input type="date" className={INPUT} value={v.startDate} onChange={set('startDate')} required />
        </div>
        <div>
          <label className={LABEL}>Last day</label>
          <input type="date" className={INPUT} value={v.endDate} min={v.startDate || undefined} onChange={set('endDate')} required />
        </div>
        <div>
          <label className={LABEL}>Status</label>
          <select className={INPUT} value={v.status} onChange={set('status')}>
            {STATUS_OPTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL}>Day rate ($)</label>
          <input inputMode="decimal" className={INPUT} value={v.dailyRate} onChange={set('dailyRate')} placeholder="optional" />
        </div>
        <div>
          <label className={LABEL}>Call time</label>
          <input className={INPUT} value={v.callTime} onChange={set('callTime')} placeholder="e.g. 6:00 AM" />
        </div>
        <div>
          <label className={LABEL}>Driver</label>
          <select className={INPUT} value={v.vendorDriverId} onChange={set('vendorDriverId')}>
            <option value="">— not yet —</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <p className="mt-1 text-[12px] text-[#6b7280]">
            Picking one emails them their own page for this job. <a href={`${base}/drivers`} className="font-semibold text-[var(--hq-accent)]">Add a driver</a>
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL}>Location</label>
          <textarea className={`${INPUT} min-h-[64px]`} value={v.location} onChange={set('location')} placeholder="address, gate, parking notes" />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL}>Notes</label>
          <textarea className={`${INPUT} min-h-[64px]`} value={v.notes} onChange={set('notes')} />
        </div>
      </div>

      {conflicts && (
        <div className="rounded-lg border border-[#e7c46a] bg-[#fff7e0] px-4 py-3 text-[14px] text-[#5a4300]">
          <div className="font-semibold">This unit is already spoken for on those days:</div>
          <ul className="mt-1.5 space-y-0.5">
            {conflicts.map((c, i) => (
              <li key={i}>
                {c.title} · {fmt(c.startDate)}{c.startDate !== c.endDate ? ` – ${fmt(c.endDate)}` : ''}{c.source === 'partner' ? ' (from SirReel)' : ''}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={busy} className={BTN_SECONDARY} onClick={() => submit(true)}>Book it anyway</button>
            <button type="button" className={`${BTN_SECONDARY} border-transparent`} onClick={() => setConflicts(null)}>Change the dates</button>
          </div>
        </div>
      )}
      {error && <div className="rounded-lg border border-[#f2c9c9] bg-[#fff5f5] px-4 py-2.5 text-[14px] text-[#991b1b]">{error}</div>}

      <div className="flex items-center gap-2 pt-1">
        <button type="submit" disabled={busy || units.length === 0} className={BTN_PRIMARY}>{bookingId ? 'Save changes' : 'Create booking'}</button>
        <button type="button" className={BTN_SECONDARY} onClick={() => router.push(`${base}/bookings`)}>Back</button>
      </div>
    </form>
  )
}
