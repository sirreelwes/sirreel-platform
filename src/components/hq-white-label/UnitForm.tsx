'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { hqFetch } from './hqFetch'
import { BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT, LABEL, MUTED } from './ui'

export interface UnitFormValues {
  name: string; vehicleType: string; daily: string; weekly: string; monthly: string; rateNotes: string; specs: string; offeredToPartner: boolean; active: boolean
}

export function UnitForm({ base, token, unitId, initial, ratesLocked }: { base: string; token: string; unitId?: string; initial?: Partial<UnitFormValues>; ratesLocked?: boolean }) {
  const router = useRouter()
  const [v, setV] = useState<UnitFormValues>({
    name: initial?.name ?? '', vehicleType: initial?.vehicleType ?? '', daily: initial?.daily ?? '', weekly: initial?.weekly ?? '', monthly: initial?.monthly ?? '',
    rateNotes: initial?.rateNotes ?? '', specs: initial?.specs ?? '', offeredToPartner: initial?.offeredToPartner ?? false, active: initial?.active ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof UnitFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setV((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const body: Record<string, unknown> = { name: v.name, vehicleType: v.vehicleType, specs: v.specs, rateNotes: v.rateNotes, offeredToPartner: v.offeredToPartner, active: v.active }
    if (!ratesLocked) Object.assign(body, { daily: v.daily, weekly: v.weekly, monthly: v.monthly })
    const r = unitId
      ? await hqFetch(`/api/public/vendor-hq/${token}/fleet/${unitId}`, 'PATCH', body)
      : await hqFetch(`/api/public/vendor-hq/${token}/fleet`, 'POST', body)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    router.push(`${base}/fleet`)
    router.refresh()
  }

  return (
    <form className={`${CARD} p-5 space-y-4`} onSubmit={submit}>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={LABEL}>Unit name</label>
          <input className={INPUT} value={v.name} onChange={set('name')} placeholder="e.g. 2-Room Star Wagon #3" required />
        </div>
        <div>
          <label className={LABEL}>Type</label>
          <input className={INPUT} value={v.vehicleType} onChange={set('vehicleType')} placeholder="Star trailer, honeywagon, fuel truck…" />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL}>Rates ($)</label>
          <div className="grid grid-cols-3 gap-3">
            <input inputMode="decimal" className={INPUT} value={v.daily} onChange={set('daily')} placeholder="day" disabled={ratesLocked} />
            <input inputMode="decimal" className={INPUT} value={v.weekly} onChange={set('weekly')} placeholder="week" disabled={ratesLocked} />
            <input inputMode="decimal" className={INPUT} value={v.monthly} onChange={set('monthly')} placeholder="month" disabled={ratesLocked} />
          </div>
          {ratesLocked && <p className={`${MUTED} mt-1.5`}>This unit is offered to SirReel, so its rates are on file with them — propose a change from your SirReel partner page.</p>}
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL}>Rate notes</label>
          <input className={INPUT} value={v.rateNotes} onChange={set('rateNotes')} placeholder="3-day week, minimums, delivery…" />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL}>Specs (one per line)</label>
          <textarea className={`${INPUT} min-h-[90px]`} value={v.specs} onChange={set('specs')} placeholder={'40 ft\n2 slide-outs\nOnboard generator'} />
        </div>
        <div className="sm:col-span-2 space-y-2">
          <label className="flex items-start gap-2.5 text-[14px] text-[#111827]">
            <input type="checkbox" className="mt-1" checked={v.offeredToPartner} onChange={set('offeredToPartner')} />
            <span>
              <span className="font-semibold">Offer this unit to SirReel for sublease</span>
              <span className={`block ${MUTED}`}>SirReel can quote it to productions at the rates on file. Turning this on tells them; turning it off takes it off their roster.</span>
            </span>
          </label>
          {unitId && (
            <label className="flex items-start gap-2.5 text-[14px] text-[#111827]">
              <input type="checkbox" className="mt-1" checked={v.active} onChange={set('active')} />
              <span>
                <span className="font-semibold">In service</span>
                <span className={`block ${MUTED}`}>Untick to retire it — it drops off the calendar and the booking form but keeps its history.</span>
              </span>
            </label>
          )}
        </div>
      </div>
      {error && <div className="rounded-lg border border-[#f2c9c9] bg-[#fff5f5] px-4 py-2.5 text-[14px] text-[#991b1b]">{error}</div>}
      <div className="flex items-center gap-2 pt-1">
        <button type="submit" disabled={busy} className={BTN_PRIMARY}>{unitId ? 'Save changes' : 'Add unit'}</button>
        <button type="button" className={BTN_SECONDARY} onClick={() => router.push(`${base}/fleet`)}>Back</button>
      </div>
    </form>
  )
}
