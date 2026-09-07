'use client'
/**
 * "The driver's hours are in" — the strip that carries logged hours onto
 * the order, and from there onto the invoice.
 *
 * Wes 2026-09-07: "now wire the actual hours to the invoice." The quote
 * priced an estimated day; the driver logged what really happened. This
 * shows both, priced by the same ladder, and applies the real number on a
 * click. Never automatic: the invoice generator reads live order lines, so
 * applying IS billing, and that stays a person's decision.
 *
 * Renders nothing until a driver line exists with hours logged against it.
 */
import { useCallback, useEffect, useState } from 'react'

interface TrueUpLine {
  lineId: string
  description: string
  quoted: number
  actualHours: number
  actualPay: number
  delta: number
  summary: string
  applicable: boolean
  blockedReason: string | null
  days: { workDate: string; spanHours: number }[]
}

const money = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

export function DriverTrueUpPrompt({
  orderId, canEdit, onChanged,
}: { orderId: string; canEdit: boolean; onChanged?: () => void }) {
  const [lines, setLines] = useState<TrueUpLine[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/orders/${orderId}/driver-true-up`)
      .then((r) => r.json())
      .then((j) => setLines(Array.isArray(j.lines) ? j.lines : []))
      .catch(() => setLines([]))
  }, [orderId])
  useEffect(load, [load])

  async function apply(lineId: string) {
    setBusy(lineId); setError(null); setNote(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/driver-true-up`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineId }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error ?? 'Could not apply the hours.')
      setNote(`Line updated from ${money(j.from)} to ${money(j.to)}. It bills at the hours worked.`)
      load()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply the hours.')
    } finally {
      setBusy(null)
    }
  }

  // Only speak when there is something to say: hours are logged.
  const withHours = (lines ?? []).filter((l) => l.days.length > 0)
  if (withHours.length === 0) return null

  return (
    <div className="space-y-2">
      {withHours.map((l) => {
        const settled = !l.applicable
        return (
          <div
            key={l.lineId}
            className={`rounded-lg border p-3 text-sm ${settled ? 'border-lt-hairline bg-lt-inner' : 'border-amber-300 bg-amber-50'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-lt-fg">
                  Driver hours are in
                  <span className="ml-2 font-normal text-lt-fg2">
                    {l.actualHours} hrs portal to portal · {money(l.actualPay)}
                  </span>
                </div>
                <div className="mt-0.5 text-lt-fg2">{l.summary}</div>
                {settled && <div className="mt-0.5 text-lt-fg3">Nothing to change — the line already bills this.</div>}
              </div>
              {!settled && canEdit && (
                <button
                  type="button"
                  onClick={() => apply(l.lineId)}
                  disabled={busy === l.lineId}
                  className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-50"
                >
                  {busy === l.lineId ? 'Applying…' : `Bill ${money(l.actualPay)}`}
                </button>
              )}
            </div>
            {!settled && (
              <div className="mt-1.5 text-xs text-lt-fg3">
                {l.delta > 0
                  ? `${money(l.delta)} more than the quote — the day ran long.`
                  : `${money(l.delta)} less than the quote — the day came in short.`}{' '}
                Applying puts it on the invoice.
              </div>
            )}
          </div>
        )
      })}
      {error && <div className="text-xs text-rose-700">{error}</div>}
      {note && <div className="text-xs text-emerald-700">{note}</div>}
    </div>
  )
}
