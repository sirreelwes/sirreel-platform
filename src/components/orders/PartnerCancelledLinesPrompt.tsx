'use client'
/**
 * "A partner cancelled — this line isn't on the pick list" — the warning on the
 * order page, with the one-click fix.
 *
 * Wes 2026-09-11: partner lines stay off the pick list, and "there needs to be
 * a warning wired in" for the line a partner cancels and SirReel then fills
 * from its own shelf. The same lines raise an action item
 * (partner-cancelled-off-pick-list); this is where it gets fixed.
 *
 * Renders nothing unless such a line is waiting (lib/orders/partnerCancelledLines.ts).
 */
import { useCallback, useEffect, useState } from 'react'

interface WaitingLine {
  lineId: string
  description: string
  quantity: number
  vendorName: string | null
  unitName: string | null
}

export function PartnerCancelledLinesPrompt({
  orderId, canEdit, onChanged,
}: { orderId: string; canEdit: boolean; onChanged?: () => void }) {
  const [lines, setLines] = useState<WaitingLine[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/orders/${orderId}/partner-cancelled-lines`)
      .then((r) => r.json())
      .then((j) => setLines(Array.isArray(j.lines) ? j.lines : []))
      .catch(() => setLines([]))
  }, [orderId])
  useEffect(load, [load])

  async function putOnList(lineId: string) {
    setBusy(lineId); setError(null); setNote(null)
    try {
      const r = await fetch(`/api/orders/${orderId}/partner-cancelled-lines`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lineId }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error ?? 'Could not put it on the pick list.')
      setNote('On the pick list — the warehouse will see it.')
      load()
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not put it on the pick list.')
    } finally {
      setBusy(null)
    }
  }

  if (!lines || lines.length === 0) {
    return note ? <div className="text-xs text-chip-good-fg">{note}</div> : null
  }

  return (
    <div className="space-y-2">
      {lines.map((l) => (
        <div key={l.lineId} className="rounded-lg border border-chip-warn-fg/40 bg-chip-warn-bg p-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-chip-warn-fg">
                Not on the pick list
                <span className="ml-2 font-normal text-lt-fg">{l.quantity} × {l.description}</span>
              </div>
              <div className="mt-0.5 text-lt-fg2">
                {l.vendorName ?? 'The partner'}’s booking{l.unitName ? ` for ${l.unitName}` : ''} was cancelled, so this line is ours to
                fill. Partner lines are kept off the pick list, so the warehouse was never told. Put it on the list, or remove the
                line if it isn’t going out.
              </div>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => putOnList(l.lineId)}
                disabled={busy === l.lineId}
                className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-50"
              >
                {busy === l.lineId ? 'Adding…' : 'Put it on the pick list'}
              </button>
            )}
          </div>
        </div>
      ))}
      {error && <div className="text-xs text-chip-bad-fg">{error}</div>}
    </div>
  )
}
