'use client'

/**
 * Blind pickup / blind return, flipped straight from the reservation on
 * the gantt (Wes 2026-09-15: sales should be able to "click blind on that
 * reservation"). The flags live on the ORDER — the reservation has no
 * column of its own — and the board paints a bar violet when ANY live
 * order on the job carries one, so a toggle writes EVERY live order:
 * setting one order would leave a second order's stale flag keeping the
 * bar violet after it was switched off.
 *
 * A reservation with no order yet has nowhere to store the answer; the
 * row says so instead of pretending to save.
 *
 * Instructions (gate code, where to park) stay on the order page — this is
 * the flag, not the brief.
 */

import { useState } from 'react'
import { EyeOff } from 'lucide-react'

export type BlindOrder = {
  id: string
  orderNumber: string
  status: string
  blindPickup: boolean
  blindReturn: boolean
}

export type BlindKind = 'blindPickup' | 'blindReturn'
type Kind = BlindKind

export function BlindHandoffToggles({
  orders,
  canEdit,
  onChanged,
  kinds = ['blindPickup', 'blindReturn'],
  size = 'sm',
  className = 'mb-3',
}: {
  orders: BlindOrder[]
  canEdit: boolean
  /** Which toggles to show — the yard check list shows only the edge it is on. */
  kinds?: Kind[]
  /** 'md' for yard terminals, read standing up. */
  size?: 'sm' | 'md'
  className?: string
  /** Called with the orders as they now stand, after the write lands. */
  onChanged: (next: BlindOrder[]) => void
}) {
  const [pending, setPending] = useState<Kind | null>(null)
  const [err, setErr] = useState('')
  const live = orders.filter((o) => o.status !== 'CANCELLED')
  const on = {
    blindPickup: live.some((o) => o.blindPickup),
    blindReturn: live.some((o) => o.blindReturn),
  }

  async function toggle(kind: Kind) {
    if (!canEdit || pending || live.length === 0) return
    const value = !on[kind]
    setErr('')
    setPending(kind)
    try {
      const results = await Promise.all(
        live.map((o) =>
          fetch(`/api/orders/${o.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [kind]: value }),
          }).then((r) => r.ok),
        ),
      )
      const saved = new Set(live.filter((_, i) => results[i]).map((o) => o.id))
      if (saved.size < live.length) setErr(`Couldn't update ${live.length - saved.size} order${live.length - saved.size === 1 ? '' : 's'} — try again.`)
      onChanged(orders.map((o) => (saved.has(o.id) ? { ...o, [kind]: value } : o)))
    } catch {
      setErr("Couldn't save — try again.")
    } finally {
      setPending(null)
    }
  }

  const chip = (kind: Kind, label: string) => {
    const active = on[kind]
    return (
      <button
        type="button"
        onClick={() => toggle(kind)}
        disabled={!canEdit || !!pending || live.length === 0}
        aria-pressed={active}
        title={
          live.length === 0
            ? 'Blind handoff is set on the order — write the order first'
            : active
              ? `${label} — the driver handles it without staff. Click to turn off.`
              : `Mark as ${label.toLowerCase()} — the driver handles it without staff`
        }
        className={`inline-flex items-center gap-1 rounded-md border font-semibold ${size === 'md' ? 'px-2.5 py-1.5 text-[13px]' : 'px-2 py-1 text-[12px]'} transition-colors disabled:cursor-not-allowed ${
          active
            ? 'border-violet-600 bg-violet-500 text-white hover:bg-violet-600'
            : 'border-lt-hairline bg-lt-card text-lt-fg2 hover:border-violet-400 hover:bg-violet-50 hover:text-violet-800'
        } ${live.length === 0 ? 'opacity-50' : ''} ${pending === kind ? 'opacity-60' : ''}`}
      >
        <EyeOff size={size === 'md' ? 14 : 12} aria-hidden />
        {label}
      </button>
    )
  }

  const note = size === 'md' ? 'text-[13px]' : 'text-[11px]'
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {kinds.includes('blindPickup') && chip('blindPickup', 'Blind pickup')}
      {kinds.includes('blindReturn') && chip('blindReturn', 'Blind return')}
      {live.length === 0 && <span className={`${note} text-lt-fg3`}>Needs an order first</span>}
      {live.length > 1 && <span className={`${note} text-lt-fg3`}>Applies to all {live.length} orders on this job</span>}
      {err && <span className={`${note} text-rose-700`}>{err}</span>}
    </div>
  )
}
