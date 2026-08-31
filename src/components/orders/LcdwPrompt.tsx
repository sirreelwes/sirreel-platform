'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * The damage-waiver offer on an order.
 *
 * Wes, 2026-08-29: LCDW "should be suggested as an option when adding any
 * eligible vehicle … to either the agent or the client who is building an
 * order," at "$24/day."
 *
 * ── Why a suggestion and not a checkbox in a fees list ─────────────
 *
 * The waiver was previously only ever chosen in the client portal, at
 * signing — long after the quote was priced. So the number the client
 * approved and the number they were charged could differ by the whole
 * waiver, and no rep ever had a reason to mention it. Putting it on the
 * order, priced, means the quote the client sees already answers the
 * question.
 *
 * ── Why the excluded vehicles are shown, always ────────────────────
 *
 * The rental agreement excludes PopVans and VideoVans, and we cannot
 * waive damage on a partner's unit at all. If the panel silently priced
 * only the eligible lines, a rep would read "waiver added" on an order
 * whose VideoVan is not covered, and would tell the client so in good
 * faith. The exclusion is the part that has to be visible.
 */

interface Verdict {
  id: string
  description: string
  reason?: 'not-a-vehicle' | 'specialty-vehicle' | 'partner-vehicle'
}

interface Coverage {
  available: boolean
  applied: boolean
  perDay: number | null
  vehicleDays: number
  estimatedTotal: number | null
  summary: string
  eligible: Verdict[]
  excluded: Verdict[]
  allExcluded: boolean
  feeMissing: boolean
}

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const WHY: Record<string, string> = {
  'specialty-vehicle': 'specialty vehicle — excluded by the rental agreement',
  'partner-vehicle': "partner's vehicle — not ours to waive",
}

export function LcdwPrompt({
  orderId,
  canEdit = true,
  onChanged,
}: {
  orderId: string
  /** False on a locked order: the coverage is still SHOWN — a rep asked
   *  "is the waiver on this?" needs an answer whatever the status — but
   *  the buttons go away rather than posting into a refusal. */
  canEdit?: boolean
  onChanged?: () => void
}) {
  const [cov, setCov] = useState<Coverage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/orders/${orderId}/lcdw`, { cache: 'no-store' })
      if (r.ok) setCov(await r.json())
    } catch {
      /* A failed read hides the offer; it must never break the order page. */
    }
  }, [orderId])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (method: 'POST' | 'DELETE') => {
    setBusy(true)
    setError('')
    try {
      const r = await fetch(`/api/orders/${orderId}/lcdw`, { method })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(data?.error || 'Could not update the waiver.')
        return
      }
      await load()
      onChanged?.()
    } catch (e: any) {
      setError(e?.message || 'Could not update the waiver.')
    } finally {
      setBusy(false)
    }
  }

  // No vehicles at all → nothing to say. An order of walkies should not
  // carry an insurance panel.
  if (!cov) return null
  if (cov.eligible.length === 0 && cov.excluded.length === 0) return null

  const nothingCoverable = cov.allExcluded || cov.feeMissing

  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        cov.applied
          ? 'border-sky-700 bg-sky-950/40'
          : nothingCoverable
            ? 'border-zinc-700 bg-zinc-900'
            : 'border-amber-700/60 bg-amber-950/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-white">
            Damage waiver (LCDW)
            {cov.perDay != null && (
              <span className="ml-2 font-normal text-zinc-400">${cov.perDay}/day per vehicle</span>
            )}
          </div>
          <div className="mt-0.5 text-zinc-400">{cov.summary}</div>

          {cov.excluded.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[12px] text-zinc-500">
              {cov.excluded.map((e) => (
                <li key={e.id}>
                  <span className="text-zinc-400">{e.description}</span>
                  {e.reason && <> — not covered: {WHY[e.reason] ?? e.reason}</>}
                </li>
              ))}
            </ul>
          )}

          {cov.feeMissing && (
            <div className="mt-1.5 text-[12px] text-amber-400">
              No active LCDW fee in the catalog — add it under Admin → Fees before offering it.
            </div>
          )}
          {error && <div className="mt-1.5 text-[12px] text-red-400">{error}</div>}
        </div>

        <div className="shrink-0 text-right">
          {cov.applied ? (
            <>
              <div className="font-mono text-white">
                {cov.estimatedTotal != null ? usd(cov.estimatedTotal) : ''}
              </div>
              {canEdit && <button
                onClick={() => act('DELETE')}
                disabled={busy}
                className="mt-1 text-[12px] text-zinc-400 underline hover:text-white disabled:opacity-40"
              >
                {busy ? 'Removing…' : 'Remove'}
              </button>}
            </>
          ) : cov.available ? (
            <>
              <div className="font-mono text-white">
                {cov.estimatedTotal != null ? usd(cov.estimatedTotal) : ''}
              </div>
              <div className="text-[11px] text-zinc-500">
                {cov.vehicleDays} vehicle-day{cov.vehicleDays === 1 ? '' : 's'}
              </div>
              {canEdit && <button
                onClick={() => act('POST')}
                disabled={busy}
                className="mt-1 rounded bg-amber-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
              >
                {busy ? 'Adding…' : 'Add waiver'}
              </button>}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
