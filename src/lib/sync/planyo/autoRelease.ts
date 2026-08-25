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
 *   · Hard cap. If a run produces more candidates than the cap, release
 *     NOTHING and alert. A Planyo API or format change that made every
 *     row look cancelled would otherwise wipe the book in one night;
 *     an unusually large batch is a reason to look, not to proceed.
 */

import { prisma } from '@/lib/prisma'
import { releaseBookingItem } from '@/lib/scheduling/releaseBookingItem'
import { resolveCandidateItem } from '@/lib/sync/planyo/resolveCandidateItem'
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
    failed: [], abortedOverCap: false, cap,
    releasedDetail: [],
  }
  if (!base.enabled || candidates.length === 0) return base

  if (candidates.length > cap) {
    // Deliberately release nothing. See the header.
    return { ...base, abortedOverCap: true, attempted: candidates.length }
  }

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

  for (const c of candidates) {
    const rid = c.planyoReservationId
    if (!rid) continue
    const r = byRid.get(rid)
    if (!r) { base.skippedUnresolved++; continue }

    const resolved = resolveCandidateItem(r)
    if (!resolved.bookingItemId) { base.skippedUnresolved++; continue }
    if (resolved.matchedBy !== 'unit') { base.skippedWeakMatch++; continue }

    base.attempted++
    const out = await releaseBookingItem(resolved.bookingItemId)
    if (!out.ok) {
      base.failed.push({ planyoReservationId: rid, reason: out.reason })
      continue
    }
    if (out.alreadyReleased) base.alreadyReleased++
    else {
      base.released++
      base.releasedDetail.push({
        planyoReservationId: rid,
        unitName: r.unitName,
        bookingItemId: resolved.bookingItemId,
      })
    }
  }
  return base
}
