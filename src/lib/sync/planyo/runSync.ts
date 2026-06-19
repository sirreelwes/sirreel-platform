/**
 * Planyo→HQ daily sync orchestrator.
 *
 * One event computation function — `computeEvents` — is shared between
 * dry-run and apply. They differ ONLY in whether the events get persisted
 * and the holds applied.
 *
 * Apply path is signature-guarded: the caller must pass the event-count
 * signature it was authorized against (from a prior dry-run). runSync
 * re-computes events fresh against current Planyo state, compares, and
 * ABORTS before any write if the signature does not match.
 */

import { prisma } from '@/lib/prisma'
import {
  listReservationsFull,
  getReservationData,
  type PlanyoLine,
  type ListReservationsResult,
} from './planyoClient'
import { buildResourceCrosswalk, type CrosswalkEntry } from './resourceCrosswalk'
import {
  diffLine,
  isReservationCancelled,
  type SyncEvent,
  type HQReservationSnapshot,
} from './reconcile'
import {
  applyCreate,
  applyUpdateDates,
  applyRelease,
} from './reconcileHolds'

export interface EventCounts {
  create: number
  updateDates: number
  release: number
  releaseCandidate: number
  unmapped: number
  conflict: number
  absent: number
  noChange: number
  skipped: number
}

export interface RunSyncOpts {
  dryRun: boolean
  /** Required when dryRun=false. Counts must match the freshly-computed
   *  events exactly; otherwise the run aborts before any write. */
  authorizedSignature?: Pick<EventCounts, 'create' | 'updateDates' | 'release' | 'unmapped' | 'conflict'>
  /** Default: today-30d → today+90d (UTC days). */
  windowStart?: Date
  windowEnd?: Date
  /** Default: 0.7. Abort if pull count drops below this fraction of last success. */
  lowFactor?: number
  /** Planyo reservation IDs whose UPDATE_DATES events should be tagged
   *  `[REVERT_CORRECTION]` in the event detail (audit-distinct from
   *  operational drift). One-shot use; ignored when not set. */
  revertCorrectionIds?: Set<string>
}

export type RunSyncOutcome =
  | 'SUCCESS'
  | 'FAILED_PULL'
  | 'FAILED_INCOMPLETE'
  | 'FAILED_NETWORK'
  | 'FAILED_SUSPICIOUS_LOW'
  | 'ABORTED_SIGNATURE_MISMATCH'

export interface RunSyncResult {
  runId: string
  outcome: RunSyncOutcome
  reason?: string
  pulled: number
  inScope: number
  outOfScope: number
  counts: EventCounts
  events: SyncEvent[]
  authorizedSignature?: RunSyncOpts['authorizedSignature']
  computedSignature?: Pick<EventCounts, 'create' | 'updateDates' | 'release' | 'unmapped' | 'conflict'>
}

/**
 * Per-line event computation. DB reads only, NO writes. Shared by dry-run
 * and apply. The single source of truth for what the sync "would do".
 */
async function computeEvents(
  pull: ListReservationsResult,
): Promise<{
  events: SyncEvent[]
  counts: EventCounts
  inScope: number
  outOfScope: number
  crosswalk: Map<number, CrosswalkEntry>
  hqByRid: Map<string, HQReservationSnapshot>
}> {
  const crosswalk = await buildResourceCrosswalk(prisma)

  // ALL PLANYO_BACKFILL Bookings — past + future. The pull window is the
  // only thing that constrains scope; the HQ index must NOT pre-filter
  // narrower than the pull, or apparent "new" lines surface for past
  // Reservations that already exist (the run 27e6fb9f bug).
  const hqBookings = await prisma.booking.findMany({
    where: { source: 'PLANYO_BACKFILL', planyoCartId: { not: null } },
    select: { id: true, planyoCartId: true },
  })
  const inScopeCarts = new Set(hqBookings.map((b) => b.planyoCartId!))

  // ALL HQ Reservations with a planyoReservationId — no date filter.
  const hqResv = await prisma.reservation.findMany({
    // Exclude HQ-side CANCELLED rows from probing: once a Reservation
    // is marked CANCELLED (via the runSync RELEASE op, the manual
    // phantom sweep, or a future auto-release path), we know its state
    // and re-probing it daily would just refill the Slack channel with
    // the same RELEASE_CANDIDATE rows forever. The audit row still
    // exists for forensics; we just stop re-evaluating it.
    //
    // FOLLOW-ON — REINSTATEMENT DETECTION (filed 2026-06-18, not in
    // this push):
    //
    // This filter kills the re-flag noise but trades away symmetric
    // detection: a cancelled HQ row is never re-probed, so a Planyo
    // reinstatement (event=2 followed by later activity, user_text
    // flipping back to "confirmed") goes unnoticed — HQ silently
    // under-holds, which is the double-book direction. There are 14
    // freshly-released rows from this push that this exposure newly
    // applies to.
    //
    // Plan when the work is authorized:
    //   1. Drop the `status: { not: 'CANCELLED' }` exclusion here.
    //      Re-probe CANCELLED rows in the absence pass + overlay pass
    //      same as HOLD rows.
    //   2. In the overlay pass (and the absence pass), gate the
    //      RELEASE_CANDIDATE emission on `hq.status !== 'CANCELLED'`
    //      — if HQ is already CANCELLED and Planyo still says
    //      cancelled, emit nothing (preserves the no-nag behaviour).
    //   3. Add a new SyncOp `REINSTATE_CANDIDATE` (additive enum;
    //      symmetric to RELEASE_CANDIDATE; flag-only, human-
    //      confirmed) that fires when hq.status === 'CANCELLED' but
    //      `isReservationCancelled(probedData)` returns false — i.e.
    //      Planyo went active again.
    //   4. Slack alert builder: REINSTATE_CANDIDATE section above
    //      release-candidates, NEW vs REPEAT split (same suppression
    //      pattern as new-cart flags). When a rep restores the hold
    //      in HQ, the row flips back to HOLD and the flag clears.
    //
    // Posture: never auto-restore (the inverse of never-auto-release).
    // Release stays sticky AND we re-detect Planyo reinstatements.
    where: {
      source: 'PLANYO',
      planyoReservationId: { not: null },
      status: { not: 'CANCELLED' },
    },
    select: {
      id: true,
      planyoReservationId: true,
      planyoCartId: true,
      unitName: true,
      startTime: true,
      endTime: true,
      bookingId: true,
    },
  })
  const hqByRid = new Map<string, HQReservationSnapshot>()
  for (const r of hqResv) {
    if (!r.planyoReservationId) continue
    hqByRid.set(r.planyoReservationId, {
      id: r.id,
      planyoReservationId: r.planyoReservationId,
      planyoCartId: r.planyoCartId,
      unitName: r.unitName,
      startTime: r.startTime,
      endTime: r.endTime,
      bookingId: r.bookingId,
    })
  }

  const planyoLinesInScope = pull.results.filter((p) =>
    inScopeCarts.has(String(p.cart_id ?? '')),
  )
  const planyoRidSet = new Set(pull.results.map((p) => String(p.reservation_id)))

  const events: SyncEvent[] = []
  const counts: EventCounts = {
    create: 0,
    updateDates: 0,
    release: 0,
    releaseCandidate: 0,
    unmapped: 0,
    conflict: 0,
    absent: 0,
    noChange: 0,
    skipped: 0,
  }

  for (const line of planyoLinesInScope) {
    const hq = hqByRid.get(String(line.reservation_id))
    const ev = diffLine(line, hq, crosswalk)
    events.push(ev)
    switch (ev.op) {
      case 'CREATE': counts.create++; break
      case 'UPDATE_DATES': counts.updateDates++; break
      case 'RELEASE': counts.release++; break
      case 'FLAG_UNMAPPED': counts.unmapped++; break
      case 'LOG_CONFLICT': counts.conflict++; break
      case 'NO_CHANGE': counts.noChange++; break
      case 'SKIP_CANCELLED_NEW': counts.skipped++; break
    }
  }

  // CREATE-probe pass — every CREATE candidate gets a
  // `get_reservation_data` call to check `user_text` before we self-make
  // a phantom hold on a line that's already cancelled in Planyo. The
  // bulk pull does not carry user_text and the status code is the dead
  // canary, so this is the only safe place to check on a brand-new line.
  // Bounded by the count of new lines per run (typically <10) so the
  // probe cost stays small.
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (ev.op !== 'CREATE') continue
    const detail = await getReservationData(ev.planyoReservationId)
    if (!detail.ok) continue
    if (!isReservationCancelled(detail.data)) continue
    counts.create--
    counts.skipped++
    events[i] = {
      op: 'SKIP_CANCELLED_NEW',
      planyoReservationId: ev.planyoReservationId,
      planyoCartId: ev.planyoCartId,
      detail:
        'Planyo user_text says CANCELLED — would have created a self-made phantom; skipping. user_text=' +
        JSON.stringify(detail.data.user_text ?? ''),
      after: { userText: detail.data.user_text ?? null },
    }
  }

  // Absence pass — HQ rows in scope whose Reservation falls inside the
  // pull window but the pull didn't return them.
  //
  // Cancellation detection: Planyo drops cancelled reservations from
  // `list_reservations` (verified on 19710795). So the ABSENT set is
  // the high-probability candidate pool. For each absent row we do a
  // per-row `get_reservation_data` and check `user_text` via
  // `isReservationCancelled`. If cancelled → promote to
  // RELEASE_CANDIDATE (human-action-only — NO auto-release here).
  // Otherwise the row stays AMBIGUOUS_ABSENT.
  //
  // Trade-off: this misses cancellations on rows that Planyo STILL
  // returns in list_reservations. Those will be caught on subsequent
  // syncs as they drop out of the pull.
  for (const hq of hqResv) {
    if (!hq.planyoReservationId) continue
    if (planyoRidSet.has(hq.planyoReservationId)) continue
    if (!inScopeCarts.has(hq.planyoCartId ?? '')) continue

    const detail = await getReservationData(hq.planyoReservationId)
    if (detail.ok && isReservationCancelled(detail.data)) {
      counts.releaseCandidate++
      events.push({
        op: 'RELEASE_CANDIDATE',
        planyoReservationId: hq.planyoReservationId,
        planyoCartId: hq.planyoCartId ?? '',
        detail:
          'Planyo user_text says CANCELLED — flag for human release. user_text=' +
          JSON.stringify(detail.data.user_text ?? ''),
        before: { startTime: hq.startTime, endTime: hq.endTime, unitName: hq.unitName },
        after: { userText: detail.data.user_text ?? null },
      })
    } else {
      counts.absent++
      events.push({
        op: 'AMBIGUOUS_ABSENT',
        planyoReservationId: hq.planyoReservationId,
        planyoCartId: hq.planyoCartId ?? '',
        detail: detail.ok
          ? 'HQ row not returned by Planyo window pull; get_reservation_data says active — keep held'
          : 'HQ row not returned by Planyo window pull; get_reservation_data also failed (' +
            detail.detail +
            ') — conservative, no release',
        before: { startTime: hq.startTime, endTime: hq.endTime, unitName: hq.unitName },
      })
    }
  }

  // Future-held overlay pass — `list_reservations` does NOT reliably drop
  // cancelled rows. Planyo sometimes serves them for days/weeks after a
  // cancel. So the ABSENT-only probe misses cancelled-but-still-listed
  // rows. Here we probe every IN-SCOPE PLANYO_BACKFILL row with
  // endTime >= today (live capacity); if cancelled, demote whatever
  // op the main diff produced (NO_CHANGE / UPDATE_DATES) to
  // RELEASE_CANDIDATE. Past-dated rows are skipped — they don't consume
  // availability and age out naturally.
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const probedRids = new Set<string>() // ABSENT pass already probed these — skip
  for (const ev of events) {
    if (ev.op === 'RELEASE_CANDIDATE' || ev.op === 'AMBIGUOUS_ABSENT') {
      probedRids.add(ev.planyoReservationId)
    }
  }
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if (probedRids.has(ev.planyoReservationId)) continue
    if (ev.op === 'CREATE' || ev.op === 'FLAG_UNMAPPED' || ev.op === 'SKIP_CANCELLED_NEW') continue
    const hq = hqByRid.get(ev.planyoReservationId)
    if (!hq) continue
    if (hq.endTime < today) continue // past — skip
    if (!inScopeCarts.has(hq.planyoCartId ?? '')) continue
    probedRids.add(ev.planyoReservationId)
    const detail = await getReservationData(ev.planyoReservationId)
    if (!detail.ok) continue
    if (!isReservationCancelled(detail.data)) continue
    // Cancelled but still in the pull — demote prior op and promote to candidate.
    switch (ev.op) {
      case 'NO_CHANGE': counts.noChange--; break
      case 'UPDATE_DATES': counts.updateDates--; break
      case 'UPDATE_QTY': /* not in use yet */ break
      case 'UPDATE_STATUS': /* not in use yet */ break
      case 'LOG_CONFLICT': counts.conflict--; break
      case 'RELEASE': counts.release--; break
    }
    counts.releaseCandidate++
    events[i] = {
      op: 'RELEASE_CANDIDATE',
      planyoReservationId: ev.planyoReservationId,
      planyoCartId: ev.planyoCartId,
      detail:
        'Planyo user_text says CANCELLED (still served in list pull) — flag for human release. user_text=' +
        JSON.stringify(detail.data.user_text ?? ''),
      before: { startTime: hq.startTime, endTime: hq.endTime, unitName: hq.unitName },
      after: { userText: detail.data.user_text ?? null },
    }
  }

  return {
    events,
    counts,
    inScope: planyoLinesInScope.length,
    outOfScope: pull.results.length - planyoLinesInScope.length,
    crosswalk,
    hqByRid,
  }
}

function sig(c: EventCounts): Pick<EventCounts, 'create' | 'updateDates' | 'release' | 'unmapped' | 'conflict'> {
  return {
    create: c.create,
    updateDates: c.updateDates,
    release: c.release,
    unmapped: c.unmapped,
    conflict: c.conflict,
  }
}

function sigMatches(
  a: Pick<EventCounts, 'create' | 'updateDates' | 'release' | 'unmapped' | 'conflict'>,
  b: Pick<EventCounts, 'create' | 'updateDates' | 'release' | 'unmapped' | 'conflict'>,
): boolean {
  return (
    a.create === b.create &&
    a.updateDates === b.updateDates &&
    a.release === b.release &&
    a.unmapped === b.unmapped &&
    a.conflict === b.conflict
  )
}

export async function runSync(opts: RunSyncOpts): Promise<RunSyncResult> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const windowStart = opts.windowStart ?? offsetDate(today, -30)
  const windowEnd = opts.windowEnd ?? offsetDate(today, 90)
  const lowFactor = opts.lowFactor ?? 0.7

  const run = await prisma.planyoSyncRun.create({
    data: { windowStart, windowEnd, outcome: 'RUNNING', dryRun: opts.dryRun },
    select: { id: true },
  })
  const runId = run.id

  // 1. Pull
  const pull = await listReservationsFull({ windowStart, windowEnd })
  if (!pull.ok) {
    await prisma.planyoSyncRun.update({
      where: { id: runId },
      data: { outcome: pull.reason, reason: pull.detail, finishedAt: new Date() },
    })
    return abortShell(runId, pull.reason, pull.detail, 0)
  }

  // 2. Suspicious-low guard
  const lastSuccess = await prisma.planyoSyncRun.findFirst({
    where: { outcome: 'SUCCESS', dryRun: false },
    orderBy: { startedAt: 'desc' },
    select: { lastPullCount: true },
  })
  if (
    lastSuccess?.lastPullCount &&
    pull.results.length < lastSuccess.lastPullCount * lowFactor
  ) {
    const reason = `pull count ${pull.results.length} < ${lowFactor} × prior ${lastSuccess.lastPullCount}`
    await prisma.planyoSyncRun.update({
      where: { id: runId },
      data: {
        outcome: 'FAILED_SUSPICIOUS_LOW',
        reason,
        lastPullCount: pull.results.length,
        totalServerCount: pull.totalServer,
        finishedAt: new Date(),
      },
    })
    return abortShell(runId, 'FAILED_SUSPICIOUS_LOW', reason, pull.results.length)
  }

  // 3. Compute events (single source of truth — shared by dry-run and apply)
  const computed = await computeEvents(pull)
  const computedSig = sig(computed.counts)

  // 4. Signature guard — apply path must match the authorized signature
  if (!opts.dryRun) {
    if (!opts.authorizedSignature) {
      const reason = 'apply call missing authorizedSignature'
      await prisma.planyoSyncRun.update({
        where: { id: runId },
        data: {
          outcome: 'ABORTED_SIGNATURE_MISMATCH',
          reason,
          finishedAt: new Date(),
          lastPullCount: pull.results.length,
          totalServerCount: pull.totalServer,
        },
      })
      return {
        runId,
        outcome: 'ABORTED_SIGNATURE_MISMATCH',
        reason,
        pulled: pull.results.length,
        inScope: computed.inScope,
        outOfScope: computed.outOfScope,
        counts: computed.counts,
        events: computed.events,
        computedSignature: computedSig,
      }
    }
    if (!sigMatches(opts.authorizedSignature, computedSig)) {
      const reason = `signature mismatch — authorized=${JSON.stringify(opts.authorizedSignature)} computed=${JSON.stringify(computedSig)}`
      await prisma.planyoSyncRun.update({
        where: { id: runId },
        data: {
          outcome: 'ABORTED_SIGNATURE_MISMATCH',
          reason,
          finishedAt: new Date(),
          lastPullCount: pull.results.length,
          totalServerCount: pull.totalServer,
        },
      })
      return {
        runId,
        outcome: 'ABORTED_SIGNATURE_MISMATCH',
        reason,
        pulled: pull.results.length,
        inScope: computed.inScope,
        outOfScope: computed.outOfScope,
        counts: computed.counts,
        events: computed.events,
        authorizedSignature: opts.authorizedSignature,
        computedSignature: computedSig,
      }
    }
  }

  // 5. Persist events; apply if not dry-run
  for (const ev of computed.events) {
    let bookingId: string | null = null
    let bookingItemId: string | null = null
    let appliedDetail: string | null = null
    if (!opts.dryRun) {
      if (ev.op === 'CREATE') {
        const planyoLine = pull.results.find(
          (p) => String(p.reservation_id) === ev.planyoReservationId,
        )!
        const resId = parseInt(String(planyoLine.resource_id ?? 0), 10)
        const cat = computed.crosswalk.get(resId)!
        const r = await applyCreate(prisma, planyoLine, cat)
        bookingId = r.bookingId
        bookingItemId = r.bookingItemId
        appliedDetail = r.detail
      } else if (ev.op === 'UPDATE_DATES') {
        const hq = computed.hqByRid.get(ev.planyoReservationId)!
        const planyoLine = pull.results.find(
          (p) => String(p.reservation_id) === ev.planyoReservationId,
        )!
        const r = await applyUpdateDates(prisma, planyoLine, hq.id)
        bookingId = r.bookingId
        bookingItemId = r.bookingItemId
        appliedDetail = r.detail
        if (opts.revertCorrectionIds?.has(ev.planyoReservationId)) {
          appliedDetail = '[REVERT_CORRECTION] ' + appliedDetail
        }
      } else if (ev.op === 'RELEASE') {
        const hq = computed.hqByRid.get(ev.planyoReservationId)!
        const planyoLine = pull.results.find(
          (p) => String(p.reservation_id) === ev.planyoReservationId,
        )!
        const r = await applyRelease(prisma, planyoLine, hq.id, computed.crosswalk)
        bookingId = r.bookingId
        bookingItemId = r.bookingItemId
        appliedDetail = r.detail
      }
    }
    await prisma.planyoSyncEvent.create({
      data: {
        runId,
        op:
          ev.op === 'SKIP_CANCELLED_NEW'
            ? 'NO_CHANGE'
            : (ev.op as Exclude<SyncEvent['op'], 'SKIP_CANCELLED_NEW'>),
        planyoReservationId: ev.planyoReservationId || null,
        planyoCartId: ev.planyoCartId || null,
        bookingId,
        bookingItemId,
        before: (ev.before as object | undefined) ?? undefined,
        after: (ev.after as object | undefined) ?? undefined,
        detail: appliedDetail ?? ev.detail,
      },
    })
  }

  // 6. Close
  await prisma.planyoSyncRun.update({
    where: { id: runId },
    data: {
      outcome: 'SUCCESS',
      finishedAt: new Date(),
      lastPullCount: pull.results.length,
      totalServerCount: pull.totalServer,
      createdCount: computed.counts.create,
      updatedCount: computed.counts.updateDates,
      releasedCount: computed.counts.release,
      unmappedCount: computed.counts.unmapped,
      conflictCount: computed.counts.conflict,
      absentCount: computed.counts.absent,
      noChangeCount: computed.counts.noChange,
    },
  })

  return {
    runId,
    outcome: 'SUCCESS',
    pulled: pull.results.length,
    inScope: computed.inScope,
    outOfScope: computed.outOfScope,
    counts: computed.counts,
    events: computed.events,
    authorizedSignature: opts.authorizedSignature,
    computedSignature: computedSig,
  }
}

function abortShell(
  runId: string,
  outcome: RunSyncOutcome,
  reason: string,
  pulled: number,
): RunSyncResult {
  return {
    runId,
    outcome,
    reason,
    pulled,
    inScope: 0,
    outOfScope: 0,
    counts: {
      create: 0,
      updateDates: 0,
      release: 0,
      releaseCandidate: 0,
      unmapped: 0,
      conflict: 0,
      absent: 0,
      noChange: 0,
      skipped: 0,
    },
    events: [],
  }
}

function offsetDate(d: Date, days: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + days)
  return r
}
