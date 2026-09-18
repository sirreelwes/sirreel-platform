/**
 * Action Items — the pure rules (no prisma). `npm run test:action-window`.
 *
 * Wes 2026-09-17, looking at 41 COI rows and 71 replacement-cost rows on
 * his phone: "I have a ton of action items that are persistent on the
 * screen even if their time of action has passed … after [a day or two]
 * we need to have them drop off." Nothing on that list was old — every
 * provider re-derives its rows on each load, so a row exists only while
 * its condition is still true — but three things made it READ as stale:
 *
 *   1. The row's timestamp was `occurredAt`, the date the underlying
 *      record was CREATED (a booking made yesterday for a pickup six
 *      weeks out read "17h ago"). The row is now labelled by the pickup
 *      it is for, and a pickup further out than PICKUP_WINDOW_DAYS is
 *      not on the list at all. Not today's work → not on today's list.
 *   2. The COI item was one row per BOOKING while the certificate lives
 *      on the JOB (`sr_coi_checks.job_id`) — a job with two bookings was
 *      the same ask twice (Digital Paradigm, in the screenshot).
 *   3. "Replacement cost to add · 71" was the whole catalog-pricing
 *      backlog from 2026-09-11 presented as 71 tasks. It is one chore.
 *
 * Age-based expiry was considered and rejected: dropping a live "COI
 * missing" at 48h would hide the row exactly when the pickup it warns
 * about gets close. The window is measured from the PICKUP, not the row.
 */

import type { ActionItem, ActionItemPriority } from '@/lib/actionItems/types'
import { PRIORITY_RANK } from '@/lib/actionItems/types'

const DAY = 86_400_000

/** How far ahead a pickup-tied item is shown. A COI or a card for a
 *  rental going out inside two weeks is this week's chase; further out
 *  it is a row that will arrive when it matters. Providers that already
 *  looked a shorter distance ahead (kit-incomplete: 7 days) keep theirs. */
export const PICKUP_WINDOW_DAYS = 14

/** UTC midnight of the given instant — the day arithmetic below is in
 *  whole days, and every provider already compares dates at UTC midnight. */
export function startOfUtcDay(at: Date = new Date()): Date {
  const d = new Date(at)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/** Whole days from `today` (UTC midnight) to the pickup day. Negative once
 *  the pickup day has passed; 0 on the day itself. */
export function daysUntil(dueAt: Date, today: Date = startOfUtcDay()): number {
  return Math.round((startOfUtcDay(dueAt).getTime() - startOfUtcDay(today).getTime()) / DAY)
}

/** Today through today + PICKUP_WINDOW_DAYS, inclusive. The day of pickup
 *  itself still shows (Wes 2026-08-31: the morning of pickup is the last
 *  moment the ask is actionable); the day after, it is gone. */
export function inPickupWindow(startDate: Date | null | undefined, today: Date = startOfUtcDay()): boolean {
  if (!startDate) return false
  const d = daysUntil(startDate, today)
  return d >= 0 && d <= PICKUP_WINDOW_DAYS
}

/** The row label for a pickup-tied item. Replaces "17h ago" — which was
 *  the booking's creation date — with the one date that decides the
 *  work's urgency. */
export function dueLabel(dueAt: Date, today: Date = startOfUtcDay()): string {
  const d = daysUntil(dueAt, today)
  if (d < 0) return d === -1 ? 'went out yesterday' : `went out ${-d}d ago`
  if (d === 0) return 'pickup today'
  if (d === 1) return 'pickup tomorrow'
  if (d <= PICKUP_WINDOW_DAYS) return `pickup in ${d}d`
  return `pickup ${dueAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
}

/** Registry order: priority, then the soonest pickup, then newest record.
 *  A due-dated item sorts ahead of an undated one inside a priority, so a
 *  group's preview row is the pickup that is closest, not the record
 *  that was made last. */
export function compareActionItems(a: ActionItem, b: ActionItem): number {
  const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (pr !== 0) return pr
  const ad = a.dueAt?.getTime() ?? null
  const bd = b.dueAt?.getTime() ?? null
  if (ad !== null && bd !== null && ad !== bd) return ad - bd
  if (ad !== null && bd === null) return -1
  if (ad === null && bd !== null) return 1
  return b.occurredAt.getTime() - a.occurredAt.getTime()
}

// ── COI: one row per JOB ─────────────────────────────────────────────

export interface CoiBookingRow {
  id: string
  jobId: string | null
  startDate: Date
}

export interface CoiJobGroup<R extends CoiBookingRow> {
  /** The booking that fronts the item — the soonest pickup on the job.
   *  The item id is keyed on it so a "coi:<bookingId>" dismissal recorded
   *  before the merge still matches for the (usual) one-booking job. */
  lead: R
  /** Every booking on the job inside the window, soonest first. */
  bookings: R[]
}

/** Collapse per-booking rows onto their job. A booking with no job stays
 *  its own row. Input order is irrelevant; the lead is the soonest start,
 *  ties broken by id so the key is stable across loads. */
export function groupCoiByJob<R extends CoiBookingRow>(rows: R[]): CoiJobGroup<R>[] {
  const byKey = new Map<string, R[]>()
  for (const r of rows) {
    const key = r.jobId ? `job:${r.jobId}` : `booking:${r.id}`
    const arr = byKey.get(key) ?? []
    arr.push(r)
    byKey.set(key, arr)
  }
  const out: CoiJobGroup<R>[] = []
  for (const list of byKey.values()) {
    list.sort((a, b) => a.startDate.getTime() - b.startDate.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    out.push({ lead: list[0], bookings: list })
  }
  out.sort((a, b) => a.lead.startDate.getTime() - b.lead.startDate.getTime())
  return out
}

// ── Replacement cost: the exceptions, and one backlog ────────────────

export interface ReplacementGroupInput {
  /** `item:<inventoryItemId>` or `line:<wording>` */
  key: string
  inventoryItemId: string | null
  type: string
  description: string
  partner: boolean
  /** Soonest start among the orders the row is on; null = undated. */
  soonest: Date | null
  orderCount: number
}

/** A VEHICLE row going out inside this many days is its own HIGH item —
 *  a truck is the bulk of any order's exposure. */
export const REPLACEMENT_URGENT_DAYS = 7

export interface ReplacementSplit<G extends ReplacementGroupInput> {
  /** Rows loud enough to be their own item. */
  urgent: G[]
  /** Catalog rows that fold into the one backlog item. */
  catalogBacklog: G[]
  /** Free-typed lines (no catalog row) — the agent's, not the catalog's. */
  freeTyped: G[]
}

export function splitReplacementGroups<G extends ReplacementGroupInput>(
  groups: G[],
  today: Date = startOfUtcDay(),
): ReplacementSplit<G> {
  const urgent: G[] = []
  const catalogBacklog: G[] = []
  const freeTyped: G[] = []
  for (const g of groups) {
    const d = g.soonest ? daysUntil(g.soonest, today) : null
    if (g.inventoryItemId && g.type === 'VEHICLE' && d !== null && d >= 0 && d <= REPLACEMENT_URGENT_DAYS) urgent.push(g)
    else if (g.inventoryItemId) catalogBacklog.push(g)
    else freeTyped.push(g)
  }
  const bySoonest = (a: G, b: G) => (a.soonest?.getTime() ?? Infinity) - (b.soonest?.getTime() ?? Infinity)
  urgent.sort(bySoonest)
  catalogBacklog.sort(bySoonest)
  freeTyped.sort(bySoonest)
  return { urgent, catalogBacklog, freeTyped }
}

/** The one line for the backlog item. */
export function replacementBacklogSubtitle(rows: ReplacementGroupInput[], today: Date = startOfUtcDay()): string {
  const vehicles = rows.filter((r) => r.type === 'VEHICLE').length
  const partner = rows.filter((r) => r.partner).length
  const soon = rows.filter((r) => r.soonest && inPickupWindow(r.soonest, today)).length
  const one = rows.length === 1
  const parts = [`${rows.length} catalog row${one ? '' : 's'} on upcoming orders ${one ? 'has' : 'have'} no replacement cost`]
  const detail: string[] = []
  if (vehicles > 0) detail.push(`${vehicles} vehicle${vehicles === 1 ? '' : 's'}`)
  if (partner > 0) detail.push(`${partner} from a partner`)
  if (soon > 0) detail.push(`${soon} going out inside ${PICKUP_WINDOW_DAYS} days`)
  if (detail.length > 0) parts.push(`(${detail.join(', ')})`)
  parts.push(`— price ${one ? 'it' : 'them'} in the wizard, soonest pickup first`)
  return parts.join(' ')
}

export function priorityForBacklog(rows: ReplacementGroupInput[], today: Date = startOfUtcDay()): ActionItemPriority {
  // A chore, not a task: it never lights the red badge. Medium only while
  // something in it goes out inside the window, so the group still sorts
  // above the quiet quotes when it matters this week.
  return rows.some((r) => r.soonest && inPickupWindow(r.soonest, today)) ? 'medium' : 'low'
}
