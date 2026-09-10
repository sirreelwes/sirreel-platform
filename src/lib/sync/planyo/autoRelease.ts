/**
 * Auto-release of Planyo cancellations (Wes 2026-08-25, after the 42-row
 * backlog was cleared and reviewed by hand).
 *
 * Releases holds the sync classified as RELEASE_CANDIDATE — Planyo says
 * cancelled, HQ still holds the unit. Uses the same non-destructive
 * release as the button (item → UNFULFILLED, active assignments →
 * SWAPPED), so every row stays auditable and nothing is deleted.
 *
 * ── Why this is fenced ───────────────────────────────────────────────
 * A false positive frees a truck that is genuinely booked, and the
 * detection leans on parsing Planyo's `user_text`. So:
 *
 *   · OFF unless PLANYO_AUTO_RELEASE=1. An env flag, not a code change,
 *     so it can be killed at 6am without a deploy.
 *   · Only RELEASE_CANDIDATE. Never AMBIGUOUS_ABSENT — that bucket is
 *     "Planyo didn't return it and we couldn't confirm why", and it is
 *     routinely large (85 on the run that had 42 candidates). Releasing
 *     it would empty the board.
 *   · Only unit-matched rows. A single-line-booking inference is good
 *     enough for a human looking at the screen, not for an unattended
 *     job.
 *   · Hard cap. If a run would RELEASE more units than the cap, release
 *     NOTHING and alert. A Planyo API or format change that made every
 *     row look cancelled would otherwise wipe the book in one night;
 *     an unusually large batch is a reason to look, not to proceed.
 *
 * ── The cap counts RELEASES, not flags (fixed 2026-09-10) ────────────
 * It used to compare the raw candidate count against the cap, which
 * quietly turned the circuit breaker into a deadlock:
 *
 *   · a hold released through EITHER path left its Reservation at HOLD
 *     (releaseBookingItem works on capacity rows and knows nothing about
 *     Planyo), so the sync re-flagged it the next morning — forever;
 *   · that backlog of already-settled "zombies" counted toward the cap;
 *   · 37 of the 53 candidates on 2026-09-10 were zombies, so 53 > 15
 *     tripped the breaker EVERY night since the flag went on 17 days
 *     ago. The cron released nothing, and the genuinely cancelled trucks
 *     stayed on the board holding live capacity.
 *   · clearing the queue by hand made it worse — each manual release
 *     added another zombie.
 *
 * So the run now splits candidates first:
 *   SETTLED (BookingItem already UNFULFILLED) → stamp the Reservation
 *     CANCELLED via settlePlanyoCancellation and move on. Frees no
 *     capacity, cannot free a truck, so it is not capped — and it stops
 *     the row re-flagging tomorrow.
 *   LIVE (still holding a unit) → the cap applies to the unit-matched
 *     subset, i.e. exactly the rows this pass would actually release.
 *     Weak matches and unresolved rows are still left to a human.
 *
 * A storm now means "15+ units would come down tonight", which is the
 * blast radius the fence was written to bound.
 */

import { prisma } from '@/lib/prisma'
import { releaseBookingItem } from '@/lib/scheduling/releaseBookingItem'
import { resolveCandidateItem } from '@/lib/sync/planyo/resolveCandidateItem'
import { settlePlanyoCancellation } from '@/lib/sync/planyo/settleCancellation'
import type { SyncEvent } from '@/lib/sync/planyo/reconcile'

/**
 * Above this many candidates in one run, refuse and ask for a human.
 * Read at CALL time, not module load, so the value can be changed by env
 * without depending on when this module happened to be imported.
 */
export function autoReleaseCap(): number {
  const raw = Number(process.env.PLANYO_AUTO_RELEASE_CAP)
  return Number.isFinite(raw) && raw > 0 ? raw : 15
}

export function autoReleaseEnabled(): boolean {
  return process.env.PLANYO_AUTO_RELEASE === '1'
}

export interface AutoReleaseResult {
  enabled: boolean
  attempted: number
  released: number
  alreadyReleased: number
  skippedUnresolved: number
  skippedWeakMatch: number
  /** Candidates whose hold was ALREADY down; stamped CANCELLED so they
   *  stop re-flagging. Not capped — they free no capacity. */
  settledZombies: number
  /** Of those, rows that were already CANCELLED (pure no-op). */
  alreadySettled: number
  failed: Array<{ planyoReservationId: string; reason: string }>
  abortedOverCap: boolean
  cap: number
  releasedDetail: Array<{ planyoReservationId: string; unitName: string; bookingItemId: string }>
}

export async function autoReleaseCandidates(events: SyncEvent[]): Promise<AutoReleaseResult> {
  const cap = autoReleaseCap()
  const candidates = events.filter((e) => e.op === 'RELEASE_CANDIDATE')
  const base: AutoReleaseResult = {
    enabled: autoReleaseEnabled(),
    attempted: 0, released: 0, alreadyReleased: 0,
    skippedUnresolved: 0, skippedWeakMatch: 0,
    settledZombies: 0, alreadySettled: 0,
    failed: [], abortedOverCap: false, cap,
    releasedDetail: [],
  }
  if (!base.enabled || candidates.length === 0) return base

  const rids = candidates.map((c) => c.planyoReservationId).filter(Boolean) as string[]
  const reservations = await prisma.reservation.findMany({
    where: { planyoReservationId: { in: rids } },
    select: {
      planyoReservationId: true, unitName: true, category: true,
      booking: {
        select: {
          items: {
            select: {
              id: true, status: true,
              category: { select: { name: true } },
              assignments: { select: { asset: { select: { unitName: true } } } },
            },
          },
        },
      },
    },
  })
  const byRid = new Map(reservations.map((r) => [r.planyoReservationId!, r]))

  // ── Pass 1: classify, without writing anything ───────────────────────
  // Split the candidates into the rows whose hold is ALREADY down (they
  // only need their Reservation stamped so they stop re-flagging) and the
  // rows that still hold a unit. Only the latter can free capacity, so
  // only the latter is measured against the cap.
  const settleOnly: string[] = []
  const toRelease: Array<{ rid: string; bookingItemId: string; unitName: string }> = []

  for (const c of candidates) {
    const rid = c.planyoReservationId
    if (!rid) continue
    const r = byRid.get(rid)
    if (!r) { base.skippedUnresolved++; continue }

    const resolved = resolveCandidateItem(r)
    if (!resolved.bookingItemId) { base.skippedUnresolved++; continue }

    // The hold is already down — however it came down (the
    // /planyo-cancellations button, an earlier cron, a hand fix). Nothing
    // to release; it just never got recorded as settled.
    if (resolved.itemStatus === 'UNFULFILLED') { settleOnly.push(rid); continue }

    if (resolved.matchedBy !== 'unit') { base.skippedWeakMatch++; continue }
    toRelease.push({ rid, bookingItemId: resolved.bookingItemId, unitName: r.unitName })
  }

  // ── Pass 2: settle the zombies ───────────────────────────────────────
  // Deliberately NOT capped and deliberately BEFORE the cap check: this
  // writes no capacity change, and it is what stops a hand-cleared queue
  // from re-tripping the breaker tomorrow. If the cap does abort below,
  // these have still been recorded — the backlog drains either way.
  for (const rid of settleOnly) {
    const out = await settlePlanyoCancellation(rid)
    if (out.settled) base.settledZombies++
    else if (out.alreadySettled) base.alreadySettled++
    else if (out.reason) base.failed.push({ planyoReservationId: rid, reason: `settle: ${out.reason}` })
  }

  // ── Pass 3: the capped release ───────────────────────────────────────
  // The cap now bounds the number of units that would actually come down
  // tonight, which is the blast radius it was written to bound.
  if (toRelease.length > cap) {
    return { ...base, abortedOverCap: true, attempted: toRelease.length }
  }

  for (const t of toRelease) {
    base.attempted++
    const out = await releaseBookingItem(t.bookingItemId)
    if (!out.ok) {
      base.failed.push({ planyoReservationId: t.rid, reason: out.reason })
      continue
    }
    if (out.alreadyReleased) base.alreadyReleased++
    else {
      base.released++
      base.releasedDetail.push({
        planyoReservationId: t.rid,
        unitName: t.unitName,
        bookingItemId: t.bookingItemId,
      })
    }
    // Record that HQ has stopped holding this one, so tomorrow's sync
    // does not re-flag the row we just handled.
    const settled = await settlePlanyoCancellation(t.rid)
    if (settled.reason) {
      base.failed.push({ planyoReservationId: t.rid, reason: `settle: ${settled.reason}` })
    }
  }
  return base
}
