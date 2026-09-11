'use client'

/**
 * Replacement value of the rented gear — the figure the client's broker
 * writes the equipment limit off (lib/coi/replacementValue).
 *
 * Two jobs: state the number, and name what is stopping it from being final.
 * A line nothing on file could value is listed with a link to the catalog
 * row, because pricing that row is the fix — for this order and every other
 * one carrying the same item. The action-items panel raises the same rows
 * org-wide; this is the per-order view of it.
 *
 * Staff-only. The client reads the same figure through the portal's COI
 * requirements block and the broker email, phrased by
 * replacementValueSentence so the two never disagree.
 */

import Link from 'next/link'
import { useState } from 'react'
import { ShieldCheck, ShieldAlert, Check, Copy } from 'lucide-react'
import { formatReplacementValue, replacementValueSentence, toClientReplacementValue } from '@/lib/coi/replacementValue'

export type ReplacementValueData = {
  total: number
  complete: boolean
  counted: number
  valued: Array<{ lineId: string; orderId: string | null; type: string; description: string; quantity: number; each: number | null; total: number | null; source: string | null; inventoryItemId: string | null; partner: boolean }>
  missing: Array<{ lineId: string; orderId: string | null; type: string; description: string; quantity: number; each: number | null; total: number | null; source: string | null; inventoryItemId: string | null; partner: boolean }>
}

const SOURCE_WORD: Record<string, string> = {
  unit: 'reserved unit',
  catalog: 'catalog',
  register: 'RentalWorks unit',
  fleet: 'fleet class',
}

export function ReplacementValueCard({
  value,
  scope,
  compact = false,
}: {
  value: ReplacementValueData | null | undefined
  /** 'order' = this order's lines; 'job' = every live order on the job. */
  scope: 'order' | 'job'
  compact?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [showValued, setShowValued] = useState(false)
  if (!value || value.counted === 0) return null

  const client = toClientReplacementValue({ ...value, valued: value.valued as never, missing: value.missing as never })
  const sentence = replacementValueSentence(client)
  const scopeWord = scope === 'job' ? 'across this job’s live orders' : 'on this order'

  async function copy() {
    if (!sentence) return
    try {
      await navigator.clipboard.writeText(sentence.replace('on this order', scope === 'job' ? 'for this production' : 'on this order'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — the figure is on screen */
    }
  }

  return (
    <div className={`rounded-xl border ${value.complete ? 'border-lt-hairline bg-lt-card' : 'border-chip-warn-fg/25 bg-chip-warn-bg'} ${compact ? 'p-3' : 'px-4 py-3'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-lt-fg3">
            {value.complete ? <ShieldCheck size={14} aria-hidden className="text-chip-good-fg" /> : <ShieldAlert size={14} aria-hidden className="text-chip-warn-fg" />}
            Replacement value · for the client’s COI
          </div>
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-[20px] font-semibold text-lt-fg tabular-nums">
              {value.complete ? '' : 'at least '}
              {formatReplacementValue(value.total)}
            </span>
            <span className="text-[12px] text-lt-fg2">
              {value.complete
                ? `rented equipment ${scopeWord} — the broker’s equipment limit`
                : `${value.missing.length} line${value.missing.length === 1 ? '' : 's'} ${scopeWord} still ${value.missing.length === 1 ? 'has' : 'have'} no replacement cost`}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={copy}
          title="Copy the sentence the client's broker gets"
          className="inline-flex items-center gap-1.5 rounded-lg border border-lt-hairline bg-lt-card px-2.5 py-1.5 text-[12px] font-semibold text-lt-fg hover:bg-lt-inner"
        >
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
          {copied ? 'Copied' : 'Copy for broker'}
        </button>
      </div>

      {!value.complete && (
        <div className="mt-2.5 space-y-1">
          <div className="text-[12px] text-chip-warn-fg font-semibold">
            The broker writes the limit they are given — price these so the figure is a total, not a floor:
          </div>
          <ul className="space-y-0.5">
            {value.missing.map((m) => (
              <li key={m.lineId} className="flex items-center justify-between gap-3 text-[13px] text-lt-fg">
                <span className="min-w-0 truncate">
                  {m.quantity > 1 ? `${m.quantity}× ` : ''}
                  {m.description}
                  {m.partner && <span className="ml-1.5 text-[11px] text-lt-fg3">partner unit — ask them for the figure</span>}
                </span>
                {m.inventoryItemId ? (
                  <Link
                    href={`/inventory?item=${m.inventoryItemId}`}
                    className="shrink-0 text-[12px] font-semibold text-amber-700 hover:text-amber-600 underline underline-offset-2"
                  >
                    Add replacement cost
                  </Link>
                ) : (
                  <span className="shrink-0 text-[11px] text-lt-fg3">free-typed — link it to a catalog row</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {value.valued.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowValued((v) => !v)}
            className="text-[11px] font-semibold text-lt-fg3 hover:text-lt-fg"
          >
            {showValued ? 'Hide' : 'Show'} the {value.valued.length} valued line{value.valued.length === 1 ? '' : 's'}
          </button>
          {showValued && (
            <ul className="mt-1 space-y-0.5">
              {value.valued.map((v) => (
                <li key={v.lineId} className="flex items-center justify-between gap-3 text-[12px] text-lt-fg2">
                  <span className="min-w-0 truncate">
                    {v.quantity > 1 ? `${v.quantity}× ` : ''}
                    {v.description}
                    <span className="ml-1.5 text-[11px] text-lt-fg3">{v.source ? SOURCE_WORD[v.source] ?? v.source : ''}</span>
                  </span>
                  <span className="font-mono tabular-nums shrink-0">{v.total === null ? '—' : formatReplacementValue(v.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default ReplacementValueCard
