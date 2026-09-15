'use client'

// Hover card for reservation bars on the gantt (Wes 2026-09-15: "when we
// have single day rentals, can't see which company / job it's on without
// clicking on it"). A one-day bar is one day-column wide — the label
// truncates to nothing — and the native `title` it had carried only the
// paperwork count, never the client.
//
// A module-level store instead of GanttBoard state: TimelineUnitRow is
// memo()'d and the board is a very large component, so a hover must not
// re-render either. The show/hide functions are module-stable, so rows
// call them without new props. Mouse only — a touch "hover" is the tap
// that opens the bar, and the card would sit under the finger.

import { useSyncExternalStore } from 'react'
import { STAGE_LABEL, type JobStage } from '@/lib/jobs/stage'
import { readinessMeterTitle } from '@/lib/scheduling/statusTokens'
import type { JobReadiness } from '@/lib/jobs/readiness'

export interface BarHoverInfo {
  client: string
  jobName?: string | null
  jobCode?: string | null
  start: string
  end: string
  /** Stage token (inquiry/hold/booked/order/cancelled/lost). */
  stage?: string | null
  /** e.g. "2nd hold" on a backup bar, "Needs a unit" on an unassigned hold. */
  flag?: string | null
  /** "Cube 13 · SuperCube Truck", or "3 units" in the job view. */
  unit?: string | null
  agent?: string | null
  /** The job's primary contact — absent for roles that can't see client people. */
  contact?: { name: string; role: string | null; phone: string | null } | null
  orders?: string[]
  readiness?: JobReadiness
  blindPickup?: boolean
}

interface HoverState { info: BarHoverInfo; rect: { left: number; top: number; bottom: number; width: number } }

let current: HoverState | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

// Short enough to feel like the answer, long enough that sweeping the
// cursor across a busy board doesn't flash a card on every bar it crosses.
const SHOW_DELAY_MS = 180

export function showBarHover(ev: React.PointerEvent<HTMLElement>, info: BarHoverInfo) {
  if (ev.pointerType !== 'mouse' || ev.buttons !== 0) return
  const r = ev.currentTarget.getBoundingClientRect()
  const next: HoverState = { info, rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width } }
  if (pendingTimer) clearTimeout(pendingTimer)
  // Already showing a card: moving bar-to-bar swaps immediately.
  if (current) { current = next; emit(); return }
  pendingTimer = setTimeout(() => { pendingTimer = null; current = next; emit() }, SHOW_DELAY_MS)
}

export function hideBarHover() {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null }
  if (current) { current = null; emit() }
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

const fDate = (ds: string) =>
  new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

/** Inclusive calendar days — Sep 14→16 is 3, the rule everywhere in HQ. */
function spanDays(start: string, end: string): number {
  const ms = new Date(end + 'T12:00:00').getTime() - new Date(start + 'T12:00:00').getTime()
  return Math.round(ms / 86_400_000) + 1
}

const CARD_W = 300

const CONTACT_ROLE: Record<string, string> = {
  PRODUCER: 'Producer', PM: 'PM', PC: 'PC', TRANSPO: 'Transpo',
  ACCOUNTING: 'Accounting', ART_DEPT: 'Art Dept', OTHER: 'Other',
}

export function BarHoverCard() {
  const state = useSyncExternalStore(subscribe, () => current, () => null)
  if (!state) return null
  const { info, rect } = state
  const days = spanDays(info.start, info.end)
  const stageLabel = info.stage ? STAGE_LABEL[info.stage as JobStage] : null

  // Under the bar, left-aligned to the cursor-side edge; flip above when
  // the bar sits in the bottom third, clamp inside the viewport.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.max(8, Math.min(rect.left, vw - CARD_W - 8))
  const below = rect.bottom < vh * 0.66
  const pos = below ? { top: rect.bottom + 6 } : { bottom: vh - rect.top + 6 }

  return (
    <div
      role="tooltip"
      className="fixed z-[60] pointer-events-none rounded-xl border border-gray-200 bg-white shadow-xl px-3.5 py-3"
      style={{ left, width: CARD_W, ...pos }}
    >
      <div className="text-[15px] font-semibold text-gray-900 leading-snug break-words">{info.client || 'No client'}</div>
      {(info.jobName || info.jobCode) && (
        <div className="text-[13px] text-gray-700 leading-snug break-words mt-0.5">
          {info.jobName}
          {info.jobCode && <span className="ml-1.5 font-mono text-[11px] text-gray-500">{info.jobCode}</span>}
        </div>
      )}
      <div className="text-[13px] text-gray-800 mt-2">
        {info.start === info.end ? fDate(info.start) : `${fDate(info.start)} – ${fDate(info.end)}`}
        <span className="text-gray-500"> · {days} day{days === 1 ? '' : 's'}</span>
      </div>
      {(stageLabel || info.flag || info.blindPickup) && (
        <div className="flex flex-wrap gap-1 mt-2">
          {info.flag && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200">{info.flag}</span>}
          {stageLabel && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-800 border border-gray-200">{stageLabel}</span>}
          {info.blindPickup && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-800 border border-violet-200">Blind pickup</span>}
        </div>
      )}
      <dl className="mt-2 space-y-0.5 text-[12px]">
        {info.contact && (
          <Row
            label="Contact"
            value={`${info.contact.name}${info.contact.role ? ` (${CONTACT_ROLE[info.contact.role] ?? info.contact.role})` : ''}${info.contact.phone ? ` · ${info.contact.phone}` : ''}`}
          />
        )}
        {info.unit && <Row label="Unit" value={info.unit} />}
        {info.orders && info.orders.length > 0 && <Row label={info.orders.length === 1 ? 'Order' : 'Orders'} value={info.orders.join(', ')} mono />}
        {info.agent && <Row label="Agent" value={info.agent} />}
      </dl>
      {info.readiness && (
        <div className={`mt-2 pt-2 border-t border-gray-100 text-[12px] ${info.readiness.ready ? 'text-green-800' : 'text-gray-700'}`}>
          {readinessMeterTitle(info.readiness)}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-14 flex-shrink-0 text-gray-500">{label}</dt>
      <dd className={`text-gray-800 min-w-0 break-words ${mono ? 'font-mono text-[11px] leading-[18px]' : ''}`}>{value}</dd>
    </div>
  )
}
