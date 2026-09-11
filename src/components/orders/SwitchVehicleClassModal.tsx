'use client'

/**
 * "Switch class…" on a vehicle line (Wes 2026-09-11): move the line to
 * another vehicle class — liftgate to no liftgate, cargo van up to a
 * SuperCube — with the quoted rate KEPT unless the rep says otherwise.
 * "If we are out of one class but want to upgrade them at no extra cost."
 *
 * Shows every class with how many units are free for the line's own
 * dates, the class's list rate beside the rate the client was quoted,
 * and the unit choice (next available / a named truck / hold only).
 * POSTs /api/orders/[id]/line-items/[lineId]/switch-class, which moves
 * the hold and the unit and records the kept rate as an override.
 */

import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, X } from 'lucide-react'
import { useMoneyFormatter } from '@/hooks/useMoney'

export interface SwitchClassLine {
  id: string
  description: string
  quantity: number
  rate: number
  rateType: string
  pickupDate: string
  returnDate: string
}

interface ClassRow {
  id: string
  name: string
  code: string
  dailyRate: number | null
  totalUnits: number
}
interface Avail {
  free: number
  total: number
  units: { assetId: string; unitName: string; state: 'free' | 'buffer' | 'booked' }[]
}

export function SwitchVehicleClassModal({
  orderId,
  orderNumber,
  line,
  onClose,
  onChanged,
}: {
  orderId: string
  orderNumber: string
  line: SwitchClassLine
  onClose: () => void
  onChanged: () => void
}) {
  const fmtMoney = useMoneyFormatter()
  const start = line.pickupDate.slice(0, 10)
  const end = line.returnDate.slice(0, 10)
  const [classes, setClasses] = useState<ClassRow[] | null>(null)
  const [avail, setAvail] = useState<Record<string, Avail | 'loading'>>({})
  const [picked, setPicked] = useState<string | null>(null)
  const [keepRate, setKeepRate] = useState(true)
  const [unitMode, setUnitMode] = useState<'next' | 'named' | 'none'>('next')
  const [unitIds, setUnitIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ reason: string; conflicts: { bookingNumber: string; jobName: string | null; startDate: string; endDate: string; quantity: number }[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/scheduling/categories')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        const rows: ClassRow[] = (d?.categories ?? [])
          .filter((c: { department: string }) => c.department === 'VEHICLES')
          .map((c: ClassRow) => ({ id: c.id, name: c.name, code: c.code, dailyRate: c.dailyRate, totalUnits: c.totalUnits }))
        setClasses(rows)
      })
      .catch(() => { if (!cancelled) setClasses([]) })
    return () => { cancelled = true }
  }, [])

  // Availability for every class, for THIS line's dates. A dozen small
  // reads; the answer is the whole point of the picker.
  useEffect(() => {
    if (!classes || !start || !end) return
    let cancelled = false
    for (const c of classes) {
      if (avail[c.id]) continue
      setAvail((p) => ({ ...p, [c.id]: 'loading' }))
      fetch(`/api/scheduling/availability?categoryId=${encodeURIComponent(c.id)}&start=${start}&end=${end}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return
          const units = Array.isArray(d?.units) ? d.units : []
          setAvail((p) => ({ ...p, [c.id]: { free: Number(d?.freeCount ?? 0), total: Number(d?.serviceableCount ?? 0), units } }))
        })
        .catch(() => { if (!cancelled) setAvail((p) => ({ ...p, [c.id]: { free: 0, total: 0, units: [] } })) })
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes, start, end])

  const target = useMemo(() => classes?.find((c) => c.id === picked) ?? null, [classes, picked])
  const targetAvail = picked ? avail[picked] : undefined
  const need = Math.max(1, line.quantity)

  async function submit(confirmConflict = false) {
    if (!picked) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/line-items/${line.id}/switch-class`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: picked,
          keepRate,
          unitAssignment: unitMode === 'named' ? { mode: 'named', assetIds: unitIds } : { mode: unitMode },
          ...(confirmConflict ? { confirmConflict: true } : {}),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 409 && j?.requiresConfirmation) {
        setConflict({ reason: j.reason, conflicts: j.conflicts ?? [] })
        return
      }
      if (!res.ok) {
        setError(j?.reason || j?.error || `Could not switch the class (HTTP ${res.status}).`)
        return
      }
      const bound: string[] = (j?.unitAssignment?.assigned ?? []).map((a: { unitName: string }) => a.unitName)
      const released: string[] = j?.released?.units ?? []
      const note: string | null = j?.unitAssignment?.note ?? null
      alert(
        `${line.description} → ${j?.lineItem?.description ?? target?.name}\n` +
          `Rate: ${j?.rate?.kept ? `kept at ${fmtMoney(Number(j.rate.rate))}/day` : `now ${fmtMoney(Number(j?.rate?.rate ?? 0))}/day`}` +
          (j?.rate?.kept && j?.rate?.classRate && Number(j.rate.classRate) !== Number(j.rate.rate) ? ` (class lists ${fmtMoney(Number(j.rate.classRate))}/day — recorded as an override)` : '') +
          `\nReleased: ${released.length ? released.join(', ') : 'no unit was bound'}` +
          `\nReserved: ${bound.length ? bound.join(', ') : 'nothing'}${note ? `\n${note}` : ''}`,
      )
      onChanged()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-lt-card w-full max-w-2xl rounded-2xl border border-lt-hairline my-8" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start gap-3 px-5 py-4 border-b border-lt-hairline">
          <ArrowRightLeft size={18} aria-hidden className="text-amber-600 flex-none mt-0.5" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lt-fg text-[17px] font-semibold">Switch the vehicle class</h2>
            <p className="text-lt-fg2 text-[13px] mt-0.5">
              {line.quantity > 1 ? `${line.quantity}× ` : ''}{line.description} on {orderNumber} · {start} – {end} · quoted {fmtMoney(line.rate)}/{line.rateType === 'WEEKLY' ? 'wk' : 'day'}.
              The quote keeps that rate unless you change it below.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-lt-fg3 hover:text-lt-fg p-1">
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          <section>
            <div className="text-[11px] uppercase tracking-wider text-lt-fg3 font-bold mb-2">New class · free for these dates</div>
            {classes === null && <div className="text-sm text-lt-fg3">Reading the classes…</div>}
            {classes && classes.length === 0 && <div className="text-sm text-lt-fg3">No vehicle classes are reservable.</div>}
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(classes ?? []).map((c) => {
                const a = avail[c.id]
                const free = a && a !== 'loading' ? a.free : null
                const isPicked = picked === c.id
                const short = free !== null && free < need
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setPicked(c.id); setUnitIds([]) }}
                    className={`text-left rounded-lg border px-3 py-2 transition-colors ${
                      isPicked ? 'border-amber-600 bg-amber-600/10' : 'border-lt-hairline bg-lt-inner/40 hover:border-amber-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-lt-fg truncate">{c.name}</span>
                      <span className={`shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded ${
                        free === null ? 'text-lt-fg3' : short ? 'bg-chip-bad-bg text-chip-bad-fg' : 'bg-chip-good-bg text-chip-good-fg'
                      }`}>
                        {free === null ? '…' : `${free} of ${a && a !== 'loading' ? a.total : c.totalUnits} free`}
                      </span>
                    </div>
                    <div className="text-[11px] text-lt-fg3 mt-0.5">
                      list {c.dailyRate != null ? `${fmtMoney(c.dailyRate)}/day` : '—'}
                      {c.dailyRate != null && c.dailyRate !== line.rate && (
                        <span className={c.dailyRate > line.rate ? ' text-chip-warn-fg' : ' text-chip-good-fg'}>
                          {' '}· {c.dailyRate > line.rate ? '+' : '−'}{fmtMoney(Math.abs(c.dailyRate - line.rate))} vs quoted
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          {target && (
            <>
              <section className="rounded-lg border border-lt-hairline bg-lt-inner/60 px-3 py-2 space-y-1.5">
                <div className="text-[11px] uppercase tracking-wider text-lt-fg3 font-bold">Rate on the quote</div>
                <label className="flex items-start gap-2 text-sm text-lt-fg cursor-pointer">
                  <input type="radio" name="rate" checked={keepRate} onChange={() => setKeepRate(true)} className="mt-1" />
                  <span>
                    Keep {fmtMoney(line.rate)}/{line.rateType === 'WEEKLY' ? 'wk' : 'day'} — the client pays what was quoted
                    {target.dailyRate != null && target.dailyRate !== line.rate && (
                      <span className="block text-[12px] text-lt-fg2">
                        {target.name} lists {fmtMoney(target.dailyRate)}/day; the difference is recorded as an override.
                      </span>
                    )}
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-lt-fg cursor-pointer">
                  <input type="radio" name="rate" checked={!keepRate} onChange={() => setKeepRate(false)} className="mt-1" />
                  <span>
                    Bill the {target.name} rate{target.dailyRate != null ? ` (${fmtMoney(target.dailyRate)}/day list; the client's rate card wins if they have one)` : ''}
                  </span>
                </label>
              </section>

              <section className="rounded-lg border border-lt-hairline bg-lt-inner/60 px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="font-semibold text-lt-fg">Unit</span>
                  <label className="inline-flex items-center gap-1.5 text-lt-fg2 cursor-pointer">
                    <input type="radio" name="unit" checked={unitMode === 'next'} onChange={() => { setUnitMode('next'); setUnitIds([]) }} /> Next available
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-lt-fg2 cursor-pointer">
                    <input type="radio" name="unit" checked={unitMode === 'named'} onChange={() => setUnitMode('named')} /> Choose
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-lt-fg2 cursor-pointer">
                    <input type="radio" name="unit" checked={unitMode === 'none'} onChange={() => { setUnitMode('none'); setUnitIds([]) }} /> Hold the class only
                  </label>
                  <span className="text-lt-fg3">The old class's unit on this order is released.</span>
                </div>
                {unitMode === 'named' && targetAvail && targetAvail !== 'loading' && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {targetAvail.units.map((u) => {
                      const on = unitIds.includes(u.assetId)
                      const disabled = u.state === 'booked' || (!on && unitIds.length >= need)
                      return (
                        <button
                          key={u.assetId}
                          type="button"
                          disabled={disabled}
                          onClick={() => setUnitIds((ids) => (on ? ids.filter((x) => x !== u.assetId) : [...ids, u.assetId]))}
                          className={`rounded border px-2 py-0.5 text-xs font-semibold ${
                            on ? 'border-amber-600 bg-amber-600 text-white'
                              : u.state === 'booked' ? 'border-lt-hairline bg-lt-inner text-lt-fg3 line-through cursor-not-allowed'
                              : u.state === 'buffer' ? 'border-chip-warn-fg/40 bg-chip-warn-bg text-chip-warn-fg'
                              : 'border-lt-hairline bg-lt-card text-lt-fg hover:border-amber-600'
                          } disabled:opacity-60`}
                        >
                          {u.unitName}{u.state === 'buffer' ? ' · tight' : ''}
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>
            </>
          )}

          {conflict && (
            <div className="rounded-lg border border-chip-warn-fg/40 bg-chip-warn-bg px-3 py-2 text-[13px] text-chip-warn-fg">
              <div className="font-semibold">{conflict.reason}</div>
              <ul className="mt-1 list-disc pl-5">
                {conflict.conflicts.map((c, i) => (
                  <li key={i}>{c.bookingNumber}{c.jobName ? ` · ${c.jobName}` : ''} · {c.startDate}–{c.endDate} · qty {c.quantity}</li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => submit(true)} disabled={busy} className="rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50">
                  Override and switch anyway
                </button>
                <button type="button" onClick={() => setConflict(null)} className="text-xs text-lt-fg2 hover:text-lt-fg px-2">Cancel</button>
              </div>
            </div>
          )}
          {error && <div className="rounded-lg border border-chip-bad-fg/30 bg-chip-bad-bg px-3 py-2 text-[13px] text-chip-bad-fg">{error}</div>}
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-lt-hairline">
          <button type="button" onClick={onClose} className="text-sm text-lt-fg2 hover:text-lt-fg px-3 py-2">Cancel</button>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={!picked || busy || (unitMode === 'named' && unitIds.length === 0)}
            className="rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white"
          >
            {busy ? 'Switching…' : target ? `Switch to ${target.name}` : 'Pick a class'}
          </button>
        </footer>
      </div>
    </div>
  )
}
