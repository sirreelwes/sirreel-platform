/**
 * Escalating chase for work HQ booked itself.
 *
 * Wes, 2026-09-01, on natively-created bookings and orders: they "may
 * sneak up on people or get missed" — because they are ~1 row in 7 on a
 * board that is otherwise Planyo's, and Planyo is what the team still
 * watches. Imported jobs have their own workflow; these have only HQ.
 *
 * So the escalation is scoped to HQ-origin jobs (src/lib/provenance) and
 * fires on the five-check readiness rollup already computed for the rail
 * — no second definition of "ready".
 *
 * ── Routed by WHO CAN CLEAR IT, not by severity ────────────────────
 *
 * Wes: "if it's related to needed paperwork or delivery instructions or
 * something between the client and SirReel, the notifications should
 * email sales and admin. If it's something related to prepping a vehicle
 * it should notify Hugo and Julian, and if it's strictly related to
 * orders that are going out, it would be hugo and warehouse."
 *
 * A blast to everyone teaches everyone to ignore it. Each blocker goes
 * to the desk that can actually clear it:
 *
 *   coi / sign / card / driver — all four are things the CLIENT has to
 *       give us (a certificate, a signature, a card, the name of whoever
 *       is driving). Chasing a client is sales work.  → sales + admin
 *   gear — which physical unit is assigned to the booking. Fleet's
 *       call.                                          → Hugo + Julian
 *
 * "Orders going out" (the pick list) is a separate signal on the ORDER
 * rather than one of the five job checks, and already has its own
 * pickup-picklists channel for Hugo + warehouse.
 */

import type { BlockerKey } from '@/lib/jobs/readiness'
import type { NotificationChannelKey } from '@/lib/email/notificationChannels'

export type EscalationDesk = 'client-facing' | 'fleet-prep'

export const BLOCKER_DESK: Record<BlockerKey, EscalationDesk> = {
  // The client owes us these four.
  coi: 'client-facing',
  sign: 'client-facing',
  card: 'client-facing',
  driver: 'client-facing',
  // We owe ourselves this one.
  gear: 'fleet-prep',
}

export const DESK_CHANNEL: Record<EscalationDesk, NotificationChannelKey> = {
  'client-facing': 'hq-escalation-sales',
  'fleet-prep': 'hq-escalation-fleet',
}

export const DESK_LABEL: Record<EscalationDesk, string> = {
  'client-facing': 'Sales & admin',
  'fleet-prep': 'Hugo & Julian',
}

/**
 * Urgency tiers, by days until the gear leaves.
 *
 * Cut by what can still be DONE, the same reasoning as the quotes-out
 * bands. A COI three weeks out is a to-do; the same COI missing tomorrow
 * is someone driving off the lot uninsured, or not driving at all.
 *
 *   overdue  — pickup has passed and it still is not ready
 *   today    — leaves today
 *   urgent   — 1–2 days
 *   soon     — 3–6 days
 *   null     — 7+ days out, or no date: no escalation yet
 */
export type EscalationTier = 'overdue' | 'today' | 'urgent' | 'soon'

export function escalationTier(daysToPickup: number | null): EscalationTier | null {
  if (daysToPickup === null) return null
  if (daysToPickup < 0) return 'overdue'
  if (daysToPickup === 0) return 'today'
  if (daysToPickup <= 2) return 'urgent'
  if (daysToPickup <= 6) return 'soon'
  return null
}

export const TIER_RANK: Record<EscalationTier, number> = {
  overdue: 0, today: 1, urgent: 2, soon: 3,
}

/** Subject prefix — the tier has to survive a phone lock screen. */
export const TIER_PREFIX: Record<EscalationTier, string> = {
  overdue: '🔴 PAST PICKUP',
  today: '🔴 TODAY',
  urgent: '🟠 URGENT',
  soon: '🟡',
}

/**
 * Split a job's blockers by the desk that can clear them, dropping any
 * desk with nothing to do — so a job missing only a COI never reaches
 * fleet, and fleet never learns to skim these.
 */
export function routeBlockers(blockers: BlockerKey[]): Map<EscalationDesk, BlockerKey[]> {
  const out = new Map<EscalationDesk, BlockerKey[]>()
  for (const b of blockers) {
    const desk = BLOCKER_DESK[b]
    if (!desk) continue
    const list = out.get(desk) ?? []
    list.push(b)
    out.set(desk, list)
  }
  return out
}
