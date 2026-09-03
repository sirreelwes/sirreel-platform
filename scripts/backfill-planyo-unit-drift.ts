/**
 * One-time correction of HQ assignments that drifted from Planyo's unit.
 *
 * ── Why this exists ────────────────────────────────────────────────
 *
 * The Planyo cart importer wrote a BookingAssignment once, at
 * cart-import time, from Planyo's `unit_assignment`
 * (importNewCart.ts). Nothing ever revisited it: the reconciler
 * diffed dates (UPDATE_DATES) and cancellations (RELEASE) but never
 * the unit, and a grep for `bookingAssignment` across src/lib/sync
 * returned exactly one hit — that create.
 *
 * Dispatch reassigns trucks in Planyo constantly. So HQ kept the
 * VACATED unit and never picked up the NEW one, and a single asset
 * silently accumulated jobs it wasn't on. On /gantt that renders as
 * several bookings stacked on one vehicle row, which is what Wes saw
 * on 2026-09-02 and asked about ("why are there apparently multiple
 * jobs on single vehicle rows").
 *
 * Measured that day: 19 of 81 live Planyo-origin bookings held 22
 * units Planyo no longer named. Cube 23 showed three jobs; Planyo had
 * only one of them on 23 (the other two had moved to 15 and 18).
 * Cube 28's three were one real plus two ghosts.
 *
 * The durable fix is the UPDATE_UNIT op now in the daily sync. This
 * script exists only to clear the rows that drifted BEFORE that op
 * shipped — the sync corrects each line once and then this is dead.
 *
 * ── Why it calls the sync's own code ───────────────────────────────
 *
 * `diffLine` and `applyUpdateUnit` are imported, not reimplemented.
 * A bespoke copy of the matching rules here could drift from what the
 * cron does nightly, and then the two would fight over the same rows.
 * The only thing this script adds is the journal.
 *
 * ── Reversal ───────────────────────────────────────────────────────
 *
 * Every moved assignment is captured BY ID with its before/after
 * assetId and window, to tmp/planyo-unit-drift-backfill-*.json, plus
 * one AuditLog row per assignment (action `assignment.planyo_unit_drift`).
 * To undo: set assetId/startDate/endDate back BY THOSE IDS. Nothing is
 * deleted and nothing is matched by pattern.
 *
 * Wes ruled 2026-09-02: Planyo auto-wins. It stays the team's working
 * surface until the native-scheduler switch is announced.
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   export PLANYO_API_KEY=... PLANYO_SITE_ID=...
 *   npx tsx scripts/backfill-planyo-unit-drift.ts            # dry run
 *   npx tsx scripts/backfill-planyo-unit-drift.ts --apply    # correct
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'fs'
import { listReservationsFull } from '../src/lib/sync/planyo/planyoClient'
import { buildResourceCrosswalk } from '../src/lib/sync/planyo/resourceCrosswalk'
import { diffLine, type HQReservationSnapshot } from '../src/lib/sync/planyo/reconcile'
import { readHQDateLA } from '../src/lib/sync/planyo/dateConvention'
import { resolvePlanyoUnitName } from '../src/lib/scheduling/planyoNameNormalizer'
import { applyUpdateUnit, applyUpdateDates } from '../src/lib/sync/planyo/reconcileHolds'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

const OPERATOR_EMAIL = 'wes@sirreel.com'
const AUDIT_ACTION = 'assignment.planyo_unit_drift'

/** Same reach the daily sync uses: back far enough to cover in-progress
 *  rentals, forward far enough to cover the live book. */
const DAYS_BACK = 14
const DAYS_FORWARD = 90

const ymd = (d: Date) => d.toISOString().slice(0, 10)

interface Journal {
  assignmentId: string
  bookingNumber: string
  jobName: string
  planyoReservationId: string
  before: { assetId: string; unitName: string | null; startDate: string; endDate: string }
  after: { assetId: string; unitName: string | null; startDate: string; endDate: string }
}

async function main() {
  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to correct) ===')

  const operator = await prisma.user.findFirst({
    where: { email: OPERATOR_EMAIL },
    select: { id: true },
  })
  if (!operator) throw new Error(`No User row for ${OPERATOR_EMAIL} — refusing to write unattributed rows`)

  const now = new Date()
  const windowStart = new Date(now.getTime() - DAYS_BACK * 86400000)
  const windowEnd = new Date(now.getTime() + DAYS_FORWARD * 86400000)

  const pull = await listReservationsFull({ windowStart, windowEnd })
  if (!pull.ok) {
    // Same posture as the sync: a partial pull must never drive writes —
    // a line missing from the pull reads as "Planyo moved it" when it
    // only means the page didn't come back.
    throw new Error(`Planyo pull failed (${pull.reason}: ${pull.detail}) — no writes`)
  }
  console.log(`Planyo lines ${ymd(windowStart)}→${ymd(windowEnd)}: ${pull.results.length}`)

  const crosswalk = await buildResourceCrosswalk(prisma as never)

  const hqRows = await prisma.reservation.findMany({
    where: {
      planyoReservationId: { not: null },
      booking: { is: { source: 'PLANYO_BACKFILL' } },
      endTime: { gte: windowStart },
      status: { not: 'CANCELLED' },
    },
    select: {
      id: true, planyoReservationId: true, planyoCartId: true, unitName: true,
      startTime: true, endTime: true, bookingId: true,
    },
  })
  let hqByRid = new Map<string, HQReservationSnapshot>()
  for (const r of hqRows) {
    hqByRid.set(r.planyoReservationId!, {
      id: r.id,
      planyoReservationId: r.planyoReservationId!,
      planyoCartId: r.planyoCartId,
      unitName: r.unitName,
      startTime: r.startTime,
      endTime: r.endTime,
      bookingId: r.bookingId,
    })
  }
  console.log(`HQ Planyo-origin reservations in scope: ${hqRows.length}\n`)

  // Re-diff from a FRESH read of the mirror each pass: a correction in
  // pass 1 changes what pass 2 sees.
  const rediff = async () => {
    const rows = await prisma.reservation.findMany({
      where: {
        planyoReservationId: { not: null },
        booking: { is: { source: 'PLANYO_BACKFILL' } },
        endTime: { gte: windowStart },
        status: { not: 'CANCELLED' },
      },
      select: {
        id: true, planyoReservationId: true, planyoCartId: true, unitName: true,
        startTime: true, endTime: true, bookingId: true,
      },
    })
    const m = new Map<string, HQReservationSnapshot>()
    for (const r of rows) {
      m.set(r.planyoReservationId!, {
        id: r.id, planyoReservationId: r.planyoReservationId!, planyoCartId: r.planyoCartId,
        unitName: r.unitName, startTime: r.startTime, endTime: r.endTime, bookingId: r.bookingId,
      })
    }
    hqByRid = m
    return pull.results.map((line) => ({ line, ev: diffLine(line, m.get(String(line.reservation_id)), crosswalk) }))
  }

  const all = await rediff()
  const drifted = all.filter(({ ev }) => ev.op === 'UPDATE_UNIT')
  const dateDrift = all.filter(({ ev }) => ev.op === 'UPDATE_DATES')

  console.log(`UNIT DRIFT: ${drifted.length}`)
  for (const { ev } of drifted) console.log(`  res ${ev.planyoReservationId} cart ${ev.planyoCartId} — ${ev.detail}`)
  console.log(`\nDATE DRIFT: ${dateDrift.length}`)
  for (const { ev } of dateDrift) console.log(`  res ${ev.planyoReservationId} cart ${ev.planyoCartId} — ${ev.detail}`)

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to correct.')
    return
  }
  if (drifted.length === 0 && dateDrift.length === 0) {
    console.log('\nNothing to correct.')
    return
  }

  const journal: Journal[] = []
  const notApplied: string[] = []

  const runUnitPass = async (batch: typeof drifted) => {
  for (const { line, ev } of batch) {
    const hq = hqByRid.get(ev.planyoReservationId)!
    const cat = crosswalk.get(parseInt(String(line.resource_id ?? 0), 10))
    if (!cat) continue

    // Snapshot EVERY assignment on this booking before the move, then
    // re-read the same ids after and diff. Re-deriving "which row did it
    // touch" by name would duplicate applyUpdateUnit's matching rules
    // here, and a journal built from a second guess is not a reversal
    // list — this way the before/after is observed, not inferred.
    const selectAsg = {
      id: true, assetId: true, startDate: true, endDate: true,
      asset: { select: { unitName: true } },
      bookingItem: { select: { booking: { select: { bookingNumber: true, jobName: true } } } },
    } as const
    const beforeRows = await prisma.bookingAssignment.findMany({
      where: { bookingItem: { bookingId: hq.bookingId!, booking: { source: 'PLANYO_BACKFILL' } } },
      select: selectAsg,
    })

    const r = await applyUpdateUnit(prisma as never, line, hq.id, cat)
    if (r.detail.startsWith('NOT_APPLIED')) {
      notApplied.push(`res ${ev.planyoReservationId} cart ${ev.planyoCartId}: ${r.detail}`)
      continue
    }

    const afterRows = await prisma.bookingAssignment.findMany({
      where: { id: { in: beforeRows.map((b) => b.id) } },
      select: selectAsg,
    })
    const afterById = new Map(afterRows.map((a) => [a.id, a]))
    let moved = 0
    for (const b of beforeRows) {
      const a = afterById.get(b.id)
      if (!a) continue
      if (a.assetId === b.assetId && +a.startDate === +b.startDate && +a.endDate === +b.endDate) continue
      moved++
      journal.push({
        assignmentId: b.id,
        bookingNumber: b.bookingItem.booking.bookingNumber,
        jobName: b.bookingItem.booking.jobName,
        planyoReservationId: ev.planyoReservationId,
        before: { assetId: b.assetId, unitName: b.asset.unitName, startDate: ymd(b.startDate), endDate: ymd(b.endDate) },
        after: { assetId: a.assetId, unitName: a.asset.unitName, startDate: ymd(a.startDate), endDate: ymd(a.endDate) },
      })
      console.log(`  moved ${b.bookingItem.booking.bookingNumber}: ${b.asset.unitName} → ${a.asset.unitName}`)
    }
    if (moved === 0) console.log(`  (mirror only) res ${ev.planyoReservationId}: ${r.detail}`)
  }
  }

  // Pass 1 — unit moves. Some will be refused because the target unit is
  // still held under a STALE assignment window.
  console.log('\n── pass 1: unit moves ──')
  await runUnitPass(drifted)

  // Pass 2a — mirror-level date drift, through the sync's own apply
  // (which now carries the assignment window with it).
  console.log('\n── pass 2a: mirror date drift ──')
  for (const { line, ev } of dateDrift) {
    const hq = hqByRid.get(ev.planyoReservationId)
    if (!hq) continue
    const r = await applyUpdateDates(prisma as never, line, hq.id)
    if (r.detail.includes('LEFT STALE')) notApplied.push(`res ${ev.planyoReservationId} cart ${ev.planyoCartId}: ${r.detail}`)
    else if (r.detail.includes('assignment window')) console.log(`  ${r.detail.split('; ').pop()}`)
  }

  // Pass 2b — assignment windows that diverge from a mirror that is
  // ITSELF correct. This is the historical residue: applyUpdateDates
  // used to move the mirror and the Booking envelope and leave the
  // assignment behind, so a line whose dates changed months ago shows
  // no drift today while its assignment still holds the original span.
  // A window too wide holds the asset across days the rental doesn't
  // cover — which is what refused several pass-1 moves.
  //
  // Only ASSIGNED rows, only when the corrected window is free, and
  // never a widening (a shrink can't create a conflict; a shift is
  // conflict-checked). Journalled by id like every other move here.
  console.log('\n── pass 2b: assignment windows vs mirror ──')
  const mirrorRows = await prisma.reservation.findMany({
    where: {
      planyoReservationId: { not: null },
      booking: { is: { source: 'PLANYO_BACKFILL' } },
      endTime: { gte: windowStart },
      status: { not: 'CANCELLED' },
    },
    select: { id: true, bookingId: true, unitName: true, category: true, startTime: true, endTime: true },
  })
  for (const m of mirrorRows) {
    if (!m.bookingId) continue
    const startLA = readHQDateLA(m.startTime)
    const endLA = readHQDateLA(m.endTime)
    const unit = resolvePlanyoUnitName(m.unitName ?? '', m.category ?? '').lookupName
    const asg = await prisma.bookingAssignment.findFirst({
      where: {
        bookingItem: { bookingId: m.bookingId, booking: { source: 'PLANYO_BACKFILL' } },
        asset: { unitName: unit },
        status: 'ASSIGNED',
      },
      select: {
        id: true, assetId: true, startDate: true, endDate: true,
        asset: { select: { unitName: true } },
        bookingItem: { select: { booking: { select: { bookingNumber: true, jobName: true } } } },
      },
    })
    if (!asg) continue
    if (ymd(asg.startDate) === startLA && ymd(asg.endDate) === endLA) continue
    const newStart = new Date(`${startLA}T00:00:00.000Z`)
    const newEnd = new Date(`${endLA}T00:00:00.000Z`)
    const blocking = await prisma.bookingAssignment.findFirst({
      where: {
        assetId: asg.assetId,
        id: { not: asg.id },
        status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
        startDate: { lte: newEnd },
        endDate: { gte: newStart },
      },
      select: { bookingItem: { select: { booking: { select: { bookingNumber: true } } } } },
    })
    if (blocking) {
      notApplied.push(`${asg.bookingItem.booking.bookingNumber} on ${asg.asset.unitName}: window ${ymd(asg.startDate)}→${ymd(asg.endDate)} should be ${startLA}→${endLA} but that collides with ${blocking.bookingItem.booking.bookingNumber}`)
      continue
    }
    await prisma.bookingAssignment.update({ where: { id: asg.id }, data: { startDate: newStart, endDate: newEnd } })
    journal.push({
      assignmentId: asg.id,
      bookingNumber: asg.bookingItem.booking.bookingNumber,
      jobName: asg.bookingItem.booking.jobName,
      planyoReservationId: `mirror:${m.id}`,
      before: { assetId: asg.assetId, unitName: asg.asset.unitName, startDate: ymd(asg.startDate), endDate: ymd(asg.endDate) },
      after: { assetId: asg.assetId, unitName: asg.asset.unitName, startDate: startLA, endDate: endLA },
    })
    console.log(`  ${asg.bookingItem.booking.bookingNumber} ${asg.asset.unitName}: ${ymd(asg.startDate)}→${ymd(asg.endDate)} ⇒ ${startLA}→${endLA}`)
  }

  // Pass 3 — retry the unit moves that pass 1 refused. Anything still
  // refused is a genuine conflict in Planyo itself, not HQ staleness.
  const retry = (await rediff()).filter(({ ev }) => ev.op === 'UPDATE_UNIT')
  if (retry.length) {
    console.log('\n── pass 3: retry blocked unit moves ──')
    notApplied.length = 0
    await runUnitPass(retry)
  }

  mkdirSync('tmp', { recursive: true })
  const path = `tmp/planyo-unit-drift-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(path, JSON.stringify({ movedAssignmentIds: journal.map((j) => j.assignmentId), moves: journal, notApplied }, null, 2))

  await prisma.auditLog.createMany({
    data: journal.map((j) => ({
      action: AUDIT_ACTION,
      entityType: 'BookingAssignment',
      entityId: j.assignmentId,
      userId: operator.id,
      oldValues: j.before,
      newValues: j.after,
    })),
  }).catch((err) => console.error('[audit] write failed (moves stand):', err))

  console.log(`\nMoved ${journal.length} assignments to match Planyo.`)
  if (notApplied.length) {
    console.log(`\nNOT APPLIED — ${notApplied.length} need a human (truck already out, or the target unit is itself held):`)
    notApplied.forEach((n) => console.log(`  ${n}`))
  }
  console.log(`\nReversal list: ${path} — restore assetId/startDate/endDate BY THOSE IDS to undo.`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
