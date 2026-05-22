/**
 * Scheduling test suite — Chunk 2 boundary tests for the pure
 * conflict engine, plus a DB-backed capacity-1 conflict test for the
 * holds/promote/release routes (added 2026-05-22 after the Part B
 * smoke ran on a 22-unit category and never exercised the
 * double-book guard).
 *
 *   npx tsx tests/scheduling/availability.test.ts
 *   npm run test:scheduling
 *
 * Env is loaded synchronously up front, and the DB-touching imports
 * are dynamic — so the global prisma singleton (`@/lib/prisma`)
 * sees DATABASE_URL when it constructs, instead of trying to
 * resolve it from a process.env that hasn't been populated yet.
 */

import { readFileSync } from 'fs'
import path from 'path'

// Env load — must run BEFORE any prisma-touching imports.
const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const failures: string[] = []

function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message)
  else console.log(`  ok — ${message}`)
}

/** UTC midnight Date for YYYY-MM-DD. */
function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

type Asset = { id: string; unitName: string; tier: 'PREMIUM' | 'STANDARD' | 'ECONOMY' }
type AssignmentWindow = { assetId: string; startDate: Date; endDate: Date }
const asset = (id: string, name = id): Asset => ({ id, unitName: name, tier: 'STANDARD' })
const assign = (assetId: string, startISO: string, endISO: string): AssignmentWindow => ({
  assetId,
  startDate: d(startISO),
  endDate: d(endISO),
})

async function main() {
  // ── Dynamic imports — load after env is set ────────────────────
  const { computeUnitStates, clearDaysBetween, getCategoryAvailability } = await import(
    '../../src/lib/scheduling/availability'
  )
  const { prisma } = await import('../../src/lib/prisma')
  const holdsRoute = await import('../../src/app/api/scheduling/holds/route')
  const releaseRoute = await import('../../src/app/api/scheduling/booking-items/[id]/release/route')
  const promoteRoute = await import('../../src/app/api/scheduling/booking-items/[id]/promote/route')
  const stackedRoute = await import('../../src/app/api/scheduling/stacked-holds/route')
  const assignRoute = await import('../../src/app/api/scheduling/booking-items/[id]/assign/route')

  // ═══════════════════════════════════════════════════════════════
  //                  PURE TESTS (Chunk 2 boundary set)
  // ═══════════════════════════════════════════════════════════════

  console.log('clearDaysBetween primitive')
  check(clearDaysBetween(d('2026-05-10'), d('2026-05-10')) === -1, 'same day → -1 (overlap)')
  check(clearDaysBetween(d('2026-05-10'), d('2026-05-11')) === 0, 'consecutive days → 0 (no clear day)')
  check(clearDaysBetween(d('2026-05-10'), d('2026-05-12')) === 1, '1 clear day between')
  check(clearDaysBetween(d('2026-05-10'), d('2026-05-15')) === 4, '4 clear days between')

  console.log('\nexact-adjacent — return day = next start (same-day turnaround)')
  {
    const units = computeUnitStates([asset('A')], [assign('A', '2026-05-05', '2026-05-10')], d('2026-05-11'), d('2026-05-13'), 1)
    check(units[0].state === 'buffer', 'bufferDays=1 + 0 clear days before window → buffer')
  }
  {
    const units = computeUnitStates([asset('A')], [assign('A', '2026-05-05', '2026-05-10')], d('2026-05-11'), d('2026-05-13'), 0)
    check(units[0].state === 'free', 'bufferDays=0 + 0 clear days before window → free (no buffer required)')
  }

  console.log('\n1-day gap with bufferDays=1 (one full clean day in between)')
  {
    const units = computeUnitStates([asset('A')], [assign('A', '2026-05-05', '2026-05-10')], d('2026-05-12'), d('2026-05-14'), 1)
    check(units[0].state === 'free', '1 clear day with bufferDays=1 → free')
  }
  {
    const units = computeUnitStates([asset('A')], [assign('A', '2026-05-05', '2026-05-10')], d('2026-05-13'), d('2026-05-14'), 2)
    check(units[0].state === 'free', '2 clear days with bufferDays=2 → free')
  }
  {
    const units = computeUnitStates([asset('A')], [assign('A', '2026-05-05', '2026-05-10')], d('2026-05-12'), d('2026-05-14'), 2)
    check(units[0].state === 'buffer', '1 clear day with bufferDays=2 → buffer (under threshold)')
  }

  console.log('\nfull overlap (assignment fully contains window)')
  {
    const units = computeUnitStates([asset('A')], [assign('A', '2026-05-08', '2026-05-14')], d('2026-05-10'), d('2026-05-12'), 1)
    check(units[0].state === 'booked', 'assignment fully contains window → booked')
  }
  {
    const units = computeUnitStates([asset('A')], [assign('A', '2026-05-10', '2026-05-12')], d('2026-05-08'), d('2026-05-14'), 1)
    check(units[0].state === 'booked', 'window fully contains assignment → booked')
  }
  {
    const units = computeUnitStates([asset('A')], [assign('A', '2026-05-09', '2026-05-13')], d('2026-05-10'), d('2026-05-12'), 1)
    check(units[0].state === 'booked', 'partial overlap (assignment straddles window start) → booked')
  }

  console.log('\ntouching endpoints (single-day overlap)')
  {
    const units = computeUnitStates([asset('A')], [assign('A', '2026-05-01', '2026-05-10')], d('2026-05-10'), d('2026-05-12'), 1)
    check(units[0].state === 'booked', 'assignment.end === window.start → booked (endpoints inclusive)')
  }
  {
    const units = computeUnitStates([asset('A')], [assign('A', '2026-05-10', '2026-05-15')], d('2026-05-01'), d('2026-05-10'), 1)
    check(units[0].state === 'booked', 'window.end === assignment.start → booked (endpoints inclusive)')
  }

  console.log('\nsymmetric buffer — assignment AFTER the window')
  {
    const units = computeUnitStates([asset('A')], [assign('A', '2026-05-15', '2026-05-18')], d('2026-05-10'), d('2026-05-14'), 1)
    check(units[0].state === 'buffer', 'next assignment 1 day after window with bufferDays=1 → buffer')
  }
  {
    const units = computeUnitStates([asset('A')], [assign('A', '2026-05-16', '2026-05-18')], d('2026-05-10'), d('2026-05-14'), 1)
    check(units[0].state === 'free', 'next assignment 2 days after window with bufferDays=1 → free')
  }

  console.log('\nmulti-asset + multi-assignment classification')
  {
    const units = computeUnitStates(
      [asset('A', 'Cube #1'), asset('B', 'Cube #2'), asset('C', 'Cube #3')],
      [assign('A', '2026-05-09', '2026-05-13'), assign('B', '2026-05-05', '2026-05-10')],
      d('2026-05-11'),
      d('2026-05-14'),
      1,
    )
    check(units.find((u) => u.assetId === 'A')!.state === 'booked', 'A overlaps → booked')
    check(units.find((u) => u.assetId === 'B')!.state === 'buffer', 'B same-day turnaround → buffer')
    check(units.find((u) => u.assetId === 'C')!.state === 'free', 'C no assignments → free')
  }

  console.log('\nhard overlap takes priority over adjacent-buffer assignments')
  {
    const units = computeUnitStates(
      [asset('A')],
      [assign('A', '2026-05-12', '2026-05-13'), assign('A', '2026-04-30', '2026-05-10')],
      d('2026-05-11'),
      d('2026-05-14'),
      1,
    )
    check(units[0].state === 'booked', 'hard overlap dominates concurrent buffer-adjacent → booked')
  }

  console.log('\nsingle-day window')
  {
    const units = computeUnitStates([asset('A')], [assign('A', '2026-05-10', '2026-05-10')], d('2026-05-10'), d('2026-05-10'), 1)
    check(units[0].state === 'booked', 'single-day assignment on single-day window → booked')
  }
  {
    const units = computeUnitStates([asset('A')], [assign('A', '2026-05-09', '2026-05-09')], d('2026-05-10'), d('2026-05-10'), 1)
    check(units[0].state === 'buffer', 'single-day window, assignment ended day before → buffer')
  }

  // ═══════════════════════════════════════════════════════════════
  //   DB-BACKED: capacity-1 conflict + backup stack + promotion
  // ═══════════════════════════════════════════════════════════════
  // Exercises the real holds/promote/release/stacked-holds route
  // handlers against a stage-like category with totalUnits=1 and
  // exactly one serviceable Asset. This is the double-book guard
  // the Part B smoke test never hit (it ran on a 22-unit category).
  //
  // Fixed dates, fixed prefix, hard cleanup at the end.

  console.log('\n══ Capacity-1 conflict + backup stack + promote ══')

  // Fixed test windows (UTC midnight).
  const W_START = '2026-12-01' // primary + backups
  const W_END = '2026-12-03'
  const NON_OVERLAP_START = '2027-01-15' // control: non-overlapping
  const NON_OVERLAP_END = '2027-01-17'
  const FIXTURE_JOB_PREFIX = 'TEST-CAP1-FIXTURE'

  // ── Setup the fixture (idempotent) ──
  const CATEGORY_SLUG = 'test-cap1-stage'
  const ASSET_UNIT_NAME = 'Test Stage A'

  let fixtureCategory = await prisma.assetCategory.findUnique({ where: { slug: CATEGORY_SLUG } })
  if (!fixtureCategory) {
    fixtureCategory = await prisma.assetCategory.create({
      data: {
        name: 'TEST capacity-1 stage',
        slug: CATEGORY_SLUG,
        totalUnits: 1,
        dailyRate: 0,
        department: 'STAGES',
        isPublished: false,
        description: 'Test fixture — single-unit category for scheduling capacity-1 assertions.',
      },
    })
  }
  // Backfill totalUnits if a previous run created the category with a different value.
  if (fixtureCategory.totalUnits !== 1) {
    fixtureCategory = await prisma.assetCategory.update({ where: { id: fixtureCategory.id }, data: { totalUnits: 1 } })
  }

  let fixtureAsset = await prisma.asset.findFirst({
    where: { categoryId: fixtureCategory.id, unitName: ASSET_UNIT_NAME },
  })
  if (!fixtureAsset) {
    fixtureAsset = await prisma.asset.create({
      data: {
        categoryId: fixtureCategory.id,
        unitName: ASSET_UNIT_NAME,
        status: 'AVAILABLE',
        location: 'LANKERSHIM',
        tier: 'STANDARD',
        isActive: true,
        notes: 'Auto-created by tests/scheduling/availability.test.ts (capacity-1 fixture).',
      },
    })
  }
  // Force serviceable status in case a previous test mid-flight left it elsewhere.
  if (fixtureAsset.status !== 'AVAILABLE' || !fixtureAsset.isActive) {
    fixtureAsset = await prisma.asset.update({
      where: { id: fixtureAsset.id },
      data: { status: 'AVAILABLE', isActive: true },
    })
  }

  // Pick FK references for Bookings.
  const company = await prisma.company.findFirst({ select: { id: true } })
  const person = await prisma.person.findFirst({ select: { id: true } })
  const agent = await prisma.user.findFirst({ select: { id: true } })
  if (!company || !person || !agent) {
    failures.push('CAPACITY-1 SETUP: need at least one Company, Person, and User in the DB to run the DB-backed assertions')
    return
  }

  // Defensive cleanup of any leftover fixture bookings before we start.
  await prisma.booking.deleteMany({ where: { jobName: { startsWith: FIXTURE_JOB_PREFIX } } })

  // ── HTTP-handler call helpers ──
  async function postHold(jobSuffix: string, args: { startDate?: string; endDate?: string; isBackup?: boolean } = {}) {
    const body = {
      categoryId: fixtureCategory!.id,
      startDate: args.startDate ?? W_START,
      endDate: args.endDate ?? W_END,
      quantity: 1,
      companyId: company!.id,
      personId: person!.id,
      agentId: agent!.id,
      jobName: `${FIXTURE_JOB_PREFIX} ${jobSuffix}`,
      isBackup: args.isBackup ?? false,
    }
    const req = new Request('http://localhost/api/scheduling/holds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const res = await holdsRoute.POST(req as never)
    return { status: res.status, json: (await res.json()) as Record<string, unknown> }
  }

  async function postRelease(id: string) {
    const req = new Request(`http://localhost/api/scheduling/booking-items/${id}/release`, { method: 'POST' })
    const res = await releaseRoute.POST(req as never, { params: { id } })
    return { status: res.status, json: (await res.json()) as Record<string, unknown> }
  }

  async function postPromote(id: string, body: Record<string, unknown> = {}) {
    const req = new Request(`http://localhost/api/scheduling/booking-items/${id}/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const res = await promoteRoute.POST(req as never, { params: { id } })
    return { status: res.status, json: (await res.json()) as Record<string, unknown> }
  }

  async function getStacked(start: string = W_START, end: string = W_END) {
    const url = `http://localhost/api/scheduling/stacked-holds?categoryId=${fixtureCategory!.id}&start=${start}&end=${end}`
    const req = new Request(url)
    const res = await stackedRoute.GET(req as never)
    return { status: res.status, json: (await res.json()) as { ok: boolean; counts: { primary: number; backups: number }; rows: Array<{ bookingItemId: string; holdRank: number; jobName: string }> } }
  }

  // Track created BookingItem IDs for assertions + cleanup.
  let primaryItemId = ''
  let backupItemId = ''
  let thirdItemId = ''

  try {
    // ─────────────────────────────────────────────────────────────
    // 1. PRIMARY AT CAPACITY IS BLOCKED
    // ─────────────────────────────────────────────────────────────
    console.log('\n[capacity-1] 1. PRIMARY AT CAPACITY IS BLOCKED')
    const primary = await postHold('primary', {})
    check(primary.status === 201 && primary.json.ok === true, 'first rank-1 primary on capacity-1 category → created (201, ok=true)')
    if (primary.status === 201) {
      const bi = primary.json.bookingItem as { id: string; holdRank: number }
      primaryItemId = bi.id
      check(bi.holdRank === 1, `first hold lands at rank 1 (got ${bi.holdRank})`)
    }

    const availAtCap = await getCategoryAvailability(fixtureCategory.id, d(W_START), d(W_END), 1)
    check(availAtCap.availableToHold === 0, `availableToHold === 0 with primary holding the only unit (got ${availAtCap.availableToHold})`)

    const dupePrimary = await postHold('dupe-primary', {})
    check(dupePrimary.status === 409, `second rank-1 over overlapping window → 409 (got ${dupePrimary.status})`)
    check(
      dupePrimary.json.error === 'over-capacity',
      `409 error code is "over-capacity" (got "${dupePrimary.json.error}")`,
    )

    // Double-check nothing got created behind the 409.
    const stuckCheck = await prisma.bookingItem.findFirst({
      where: { categoryId: fixtureCategory.id, holdRank: 1, booking: { jobName: `${FIXTURE_JOB_PREFIX} dupe-primary` } },
    })
    check(stuckCheck === null, 'no BookingItem was persisted for the rejected dupe-primary attempt')

    // ─────────────────────────────────────────────────────────────
    // 2. BACKUP STACKS WHEN FULL
    // ─────────────────────────────────────────────────────────────
    console.log('\n[capacity-1] 2. BACKUP STACKS WHEN FULL')
    const backup = await postHold('backup-2', { isBackup: true })
    check(backup.status === 201 && backup.json.ok === true, 'rank-2 backup against at-capacity category → created (201)')
    if (backup.status === 201) {
      const bi = backup.json.bookingItem as { id: string; holdRank: number }
      backupItemId = bi.id
      check(bi.holdRank === 2, `backup lands at rank 2 (got ${bi.holdRank})`)
    }

    const availAfterBackup = await getCategoryAvailability(fixtureCategory.id, d(W_START), d(W_END), 1)
    check(
      availAfterBackup.availableToHold === 0,
      `availableToHold STILL 0 after rank-2 backup (got ${availAfterBackup.availableToHold}) — backups must not consume capacity`,
    )

    const third = await postHold('backup-3', { isBackup: true })
    check(third.status === 201 && third.json.ok === true, 'rank-3 backup → created (201)')
    if (third.status === 201) {
      const bi = third.json.bookingItem as { id: string; holdRank: number }
      thirdItemId = bi.id
      check(bi.holdRank === 3, `next backup lands at rank 3 (got ${bi.holdRank})`)
    }

    const availAfterThird = await getCategoryAvailability(fixtureCategory.id, d(W_START), d(W_END), 1)
    check(availAfterThird.availableToHold === 0, `availableToHold STILL 0 after rank-3 backup (got ${availAfterThird.availableToHold})`)

    // ─────────────────────────────────────────────────────────────
    // 3. RANK ORDERING
    // ─────────────────────────────────────────────────────────────
    console.log('\n[capacity-1] 3. RANK ORDERING')
    const stacked = await getStacked()
    check(stacked.json.ok === true, 'stacked-holds returns ok')
    check(stacked.json.counts.primary === 1, `stacked counts.primary === 1 (got ${stacked.json.counts.primary})`)
    check(stacked.json.counts.backups === 2, `stacked counts.backups === 2 (got ${stacked.json.counts.backups})`)
    const ranks = stacked.json.rows.map((r) => r.holdRank)
    check(JSON.stringify(ranks) === JSON.stringify([1, 2, 3]), `stacked rows in rank order 1→2→3 (got ${JSON.stringify(ranks)})`)

    // ─────────────────────────────────────────────────────────────
    // 4. PROMOTION RE-RANKS CORRECTLY
    // ─────────────────────────────────────────────────────────────
    console.log('\n[capacity-1] 4. PROMOTION RE-RANKS CORRECTLY')
    const release = await postRelease(primaryItemId)
    check(release.status === 200 && release.json.ok === true, 'release primary → 200 ok')

    const promote = await postPromote(backupItemId)
    check(promote.status === 200 && promote.json.ok === true, `promote rank-2 backup → 200 ok (got status ${promote.status})`)
    if (promote.status !== 200) {
      console.error('    promote response:', JSON.stringify(promote.json))
    }

    // Reload all three items from the DB.
    const postPromoteItems = await prisma.bookingItem.findMany({
      where: { id: { in: [primaryItemId, backupItemId, thirdItemId] } },
      select: { id: true, holdRank: true, status: true },
    })
    const byId = new Map(postPromoteItems.map((it) => [it.id, it]))
    const promoted = byId.get(backupItemId)
    const third3 = byId.get(thirdItemId)
    const oldPrimary = byId.get(primaryItemId)
    check(promoted?.holdRank === 1, `promoted backup is now rank 1 (got ${promoted?.holdRank})`)
    check(third3?.holdRank === 2, `former rank-3 is now rank 2 (got ${third3?.holdRank}) — contiguous queue, no gap`)
    check(oldPrimary?.status === 'UNFULFILLED', `released primary status === UNFULFILLED (got ${oldPrimary?.status})`)

    // Invariant: no two ACTIVE items share rank 1 in this window.
    const activeRank1 = await prisma.bookingItem.count({
      where: {
        categoryId: fixtureCategory.id,
        holdRank: 1,
        status: { in: ['REQUESTED', 'ASSIGNED'] },
        booking: { startDate: { lte: d(W_END) }, endDate: { gte: d(W_START) } },
      },
    })
    check(activeRank1 === 1, `exactly one ACTIVE rank-1 hold in the window after promotion (got ${activeRank1})`)

    // Capacity check after promotion: new primary still holds the unit → still 0.
    const availAfterPromote = await getCategoryAvailability(fixtureCategory.id, d(W_START), d(W_END), 1)
    check(
      availAfterPromote.availableToHold === 0,
      `availableToHold === 0 after promotion — the new primary holds the unit (got ${availAfterPromote.availableToHold})`,
    )

    // ─────────────────────────────────────────────────────────────
    // 5. NON-OVERLAPPING IS FINE (control)
    // ─────────────────────────────────────────────────────────────
    console.log('\n[capacity-1] 5. NON-OVERLAPPING IS FINE (control)')
    const nonOverlap = await postHold('non-overlap', { startDate: NON_OVERLAP_START, endDate: NON_OVERLAP_END })
    check(
      nonOverlap.status === 201 && nonOverlap.json.ok === true,
      `rank-1 primary on a non-overlapping window for the same unit → created (got status ${nonOverlap.status})`,
    )

    // ─────────────────────────────────────────────────────────────
    // 6. RANK-AWARE ASSIGN GUARD
    // ─────────────────────────────────────────────────────────────
    // Locks the must-be-correct overlap rule on the assign endpoint:
    //   · rank-1 onto rank-1-held unit → BLOCKED  (double-book guard)
    //   · rank-2 onto rank-1-held unit → ALLOWED  (backup queues; capacity unchanged)
    //   · orphan rank-2 + new rank-1   → BLOCKED  ("backup has dibs" — promote, don't stack)
    //
    // We use a SEPARATE window (and a separate stage Asset implicitly
    // by reusing fixtureAsset on a new date span) so this block doesn't
    // collide with the holds-state set up in sections 1-5.

    console.log('\n[capacity-1] 6. RANK-AWARE ASSIGN GUARD')
    const GW_START = '2027-02-10'
    const GW_END = '2027-02-12'
    const GUARD_PREFIX = `${FIXTURE_JOB_PREFIX} guard`

    // ── setup: place rank-1 primary + ASSIGN it to the stage Asset ──
    // We bypass postHold's auto-cleanup naming, but the parent
    // FIXTURE_JOB_PREFIX cleanup will still sweep these at end.
    async function callAssign(itemId: string, assetId: string) {
      const req = new Request(`http://localhost/api/scheduling/booking-items/${itemId}/assign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetId }),
      })
      const res = await assignRoute.POST(req as never, { params: { id: itemId } })
      return { status: res.status, json: (await res.json()) as Record<string, unknown> }
    }

    async function createBookingItemRaw(rank: number, suffix: string) {
      const booking = await prisma.booking.create({
        data: {
          bookingNumber: `SR-TEST-GUARD-${rank}-${suffix}-${Date.now()}`,
          companyId: company!.id, personId: person!.id, agentId: agent!.id,
          jobName: `${GUARD_PREFIX} ${rank}-${suffix}`,
          startDate: d(GW_START), endDate: d(GW_END),
          status: 'REQUEST', source: 'AGENT_DIRECT',
        },
        select: { id: true },
      })
      const item = await prisma.bookingItem.create({
        data: { bookingId: booking.id, categoryId: fixtureCategory!.id, quantity: 1, dailyRate: 0, status: 'REQUESTED', holdRank: rank },
        select: { id: true },
      })
      return item.id
    }

    // Place + assign the primary rank-1.
    const guardPrimaryItemId = await createBookingItemRaw(1, 'primary')
    const guardPrimaryAssign = await callAssign(guardPrimaryItemId, fixtureAsset.id)
    check(
      guardPrimaryAssign.status === 201 && guardPrimaryAssign.json.ok === true,
      `setup: rank-1 primary assigned to ${fixtureAsset.unitName} for GW (got ${guardPrimaryAssign.status})`,
    )

    // ── 6a. rank-1 onto rank-1-held unit → BLOCKED ──
    const dupePrimaryItemId = await createBookingItemRaw(1, 'dupe')
    const dupeResult = await callAssign(dupePrimaryItemId, fixtureAsset.id)
    check(
      dupeResult.status === 409 && dupeResult.json.error === 'over-capacity',
      `(a) rank-1 onto rank-1-held unit → 409 over-capacity (got ${dupeResult.status} ${JSON.stringify(dupeResult.json.error)})`,
    )
    const dupeAssignmentCount = await prisma.bookingAssignment.count({ where: { bookingItemId: dupePrimaryItemId } })
    check(dupeAssignmentCount === 0, `(a) no BookingAssignment was persisted on the rejected dupe-primary`)

    // ── 6b. rank-2 onto rank-1-held unit → ALLOWED, capacity unchanged ──
    const preAvail = await getCategoryAvailability(fixtureCategory.id, d(GW_START), d(GW_END), 1)
    const beforeAvailable = preAvail.availableToHold

    const guardBackupItemId = await createBookingItemRaw(2, 'backup')
    const backupResult = await callAssign(guardBackupItemId, fixtureAsset.id)
    check(
      backupResult.status === 201 && backupResult.json.ok === true,
      `(b) rank-2 onto rank-1-held unit → 201 created (got ${backupResult.status})`,
    )
    const backupAssignment = await prisma.bookingAssignment.findFirst({
      where: { bookingItemId: guardBackupItemId, assetId: fixtureAsset.id },
      select: { id: true, status: true },
    })
    check(
      backupAssignment !== null && backupAssignment.status === 'ASSIGNED',
      `(b) rank-2 BookingAssignment persisted on ${fixtureAsset.unitName} with status=ASSIGNED`,
    )

    const postAvail = await getCategoryAvailability(fixtureCategory.id, d(GW_START), d(GW_END), 1)
    check(
      postAvail.availableToHold === beforeAvailable,
      `(b) availableToHold UNCHANGED after rank-2 bind (got ${postAvail.availableToHold}, expected ${beforeAvailable}) — backup must not consume capacity`,
    )

    // ── 6c. Orphaned-backup case: only rank-2 on the unit, new rank-1 → BLOCKED ──
    // Simulate "primary released without promoting backup" by
    // directly mutating the primary's BookingAssignment to SWAPPED
    // (the same terminal Change 2 will set). The release endpoint
    // currently guards `status === 'REQUESTED'` so we can't call
    // it from here yet — bypassing for the test setup is correct;
    // we're testing the assign guard, not the release route.
    await prisma.bookingAssignment.updateMany({
      where: { bookingItemId: guardPrimaryItemId, status: 'ASSIGNED' },
      data: { status: 'SWAPPED' },
    })
    await prisma.bookingItem.update({ where: { id: guardPrimaryItemId }, data: { status: 'UNFULFILLED' } })

    const orphanNewPrimaryItemId = await createBookingItemRaw(1, 'orphan-new')
    const orphanResult = await callAssign(orphanNewPrimaryItemId, fixtureAsset.id)
    check(
      orphanResult.status === 409 && orphanResult.json.error === 'over-capacity',
      `(c) orphan rank-2 + new rank-1 → 409 over-capacity (backup has dibs) — got ${orphanResult.status} ${JSON.stringify(orphanResult.json.error)}`,
    )
    const orphanAssignmentCount = await prisma.bookingAssignment.count({ where: { bookingItemId: orphanNewPrimaryItemId } })
    check(orphanAssignmentCount === 0, `(c) no BookingAssignment persisted from the rejected new-rank-1 against an orphan-backup unit`)
  } finally {
    // ── Hard cleanup: remove every BookingItem created by this run.
    //    Deleting the parent Booking cascades to BookingItem + Reservation
    //    journal rows (cascade is on bookingId), so this one delete is
    //    enough to tidy the fixture.
    await prisma.booking.deleteMany({ where: { jobName: { startsWith: FIXTURE_JOB_PREFIX } } })
  }

  // ═══════════════════════════════════════════════════════════════
  //   DB-BACKED: buffer-encroachment + multi-qty + serviceable
  // ═══════════════════════════════════════════════════════════════
  // The capacity-1 block exercised the hard-block path. This block
  // covers the SOFT path: buffer-encroachment 409 + override, plus
  // multi-quantity over-capacity and the MAINTENANCE-status
  // exclusion that's easy to silently break.
  //
  // Fixture shape:
  //   · category "TEST capacity-2 stage", totalUnits=2
  //   · 3 assets: Test-2 Unit A (AVAILABLE), Test-2 Unit B (AVAILABLE),
  //               Test-2 Unit C (MAINTENANCE)  ← must NOT count as serviceable
  //   · pre-existing Booking + BookingAssignment on Unit A for a
  //     window ending the day before the test window — this is what
  //     puts Unit A into buffer state for the test window with
  //     bufferDays=1.

  console.log('\n══ Buffer-encroachment + multi-qty + serviceable-status ══')

  const ANCHOR_START = '2026-12-12' // anchor assignment on Unit A
  const ANCHOR_END = '2026-12-14' // ends day before test window
  const TW_START = '2026-12-15' // test window
  const TW_END = '2026-12-17'
  const CAP2_FIXTURE_PREFIX = 'TEST-CAP2-FIXTURE'

  const CAT2_SLUG = 'test-cap2-stage'
  let cap2Category = await prisma.assetCategory.findUnique({ where: { slug: CAT2_SLUG } })
  if (!cap2Category) {
    cap2Category = await prisma.assetCategory.create({
      data: {
        name: 'TEST capacity-2 stage',
        slug: CAT2_SLUG,
        totalUnits: 2,
        dailyRate: 0,
        department: 'STAGES',
        isPublished: false,
        description: 'Test fixture — two-unit category for buffer + multi-qty + serviceable-status assertions.',
      },
    })
  }
  if (cap2Category.totalUnits !== 2) {
    cap2Category = await prisma.assetCategory.update({ where: { id: cap2Category.id }, data: { totalUnits: 2 } })
  }

  async function ensureAsset(unitName: string, status: 'AVAILABLE' | 'MAINTENANCE') {
    let a = await prisma.asset.findFirst({ where: { categoryId: cap2Category!.id, unitName } })
    if (!a) {
      a = await prisma.asset.create({
        data: {
          categoryId: cap2Category!.id,
          unitName,
          status,
          location: 'LANKERSHIM',
          tier: 'STANDARD',
          isActive: true,
          notes: 'Auto-created by tests/scheduling/availability.test.ts (capacity-2 fixture).',
        },
      })
    }
    if (a.status !== status || !a.isActive) {
      a = await prisma.asset.update({ where: { id: a.id }, data: { status, isActive: true } })
    }
    return a
  }
  const unitA = await ensureAsset('Test-2 Unit A', 'AVAILABLE')
  await ensureAsset('Test-2 Unit B', 'AVAILABLE')
  await ensureAsset('Test-2 Unit C', 'MAINTENANCE')

  // Reuse the capacity-1 fixture's FK references (Company/Person/User
  // — they were validated earlier in this run).
  const company2 = await prisma.company.findFirst({ select: { id: true } })
  const person2 = await prisma.person.findFirst({ select: { id: true } })
  const agent2 = await prisma.user.findFirst({ select: { id: true } })
  if (!company2 || !person2 || !agent2) {
    failures.push('CAPACITY-2 SETUP: required Company/Person/User not present in DB')
    return
  }

  // Defensive cleanup of any leftover fixture rows before we start.
  await prisma.booking.deleteMany({
    where: { jobName: { startsWith: CAP2_FIXTURE_PREFIX } },
  })

  // Create the anchor Booking + BookingItem + BookingAssignment that
  // puts Unit A in buffer state for the test window.
  let anchorBookingId = ''
  try {
    const anchorBooking = await prisma.booking.create({
      data: {
        bookingNumber: `SR-TEST-CAP2-ANCHOR-${Date.now()}`,
        companyId: company2.id,
        personId: person2.id,
        agentId: agent2.id,
        jobName: `${CAP2_FIXTURE_PREFIX} anchor`,
        startDate: d(ANCHOR_START),
        endDate: d(ANCHOR_END),
        status: 'CONFIRMED',
        source: 'AGENT_DIRECT',
      },
      select: { id: true },
    })
    anchorBookingId = anchorBooking.id
    const anchorItem = await prisma.bookingItem.create({
      data: {
        bookingId: anchorBooking.id,
        categoryId: cap2Category.id,
        quantity: 1,
        dailyRate: 0,
        status: 'ASSIGNED',
        holdRank: 1,
      },
      select: { id: true },
    })
    await prisma.bookingAssignment.create({
      data: {
        bookingItemId: anchorItem.id,
        assetId: unitA.id,
        startDate: d(ANCHOR_START),
        endDate: d(ANCHOR_END),
        status: 'ASSIGNED',
      },
    })

    async function postHold2(jobSuffix: string, args: { quantity: number; isBackup?: boolean; bufferOverride?: boolean }) {
      const body = {
        categoryId: cap2Category!.id,
        startDate: TW_START,
        endDate: TW_END,
        quantity: args.quantity,
        companyId: company2!.id,
        personId: person2!.id,
        agentId: agent2!.id,
        jobName: `${CAP2_FIXTURE_PREFIX} ${jobSuffix}`,
        isBackup: args.isBackup ?? false,
        bufferOverride: args.bufferOverride ?? false,
        bufferDays: 1,
      }
      const req = new Request('http://localhost/api/scheduling/holds', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const res = await holdsRoute.POST(req as never)
      return { status: res.status, json: (await res.json()) as Record<string, unknown> }
    }

    // ─────────────────────────────────────────────────────────────
    // A. SERVICEABLE-STATUS EXCLUSION
    // ─────────────────────────────────────────────────────────────
    console.log('\n[capacity-2] A. SERVICEABLE-STATUS EXCLUSION')
    const baseline = await getCategoryAvailability(cap2Category.id, d(TW_START), d(TW_END), 1)
    check(
      baseline.serviceableCount === 2,
      `serviceableCount === 2 (excludes MAINTENANCE Unit C) — got ${baseline.serviceableCount}`,
    )
    check(
      baseline.freeCount === 1 && baseline.bufferCount === 1,
      `freeCount=1 / bufferCount=1 with Unit A's anchor ending 1 day before window (got free=${baseline.freeCount} buffer=${baseline.bufferCount})`,
    )
    check(
      baseline.availableToHold === 2,
      `availableToHold=2 (2 serviceable, 0 hard-booked in window, 0 REQUESTED rank=1 — got ${baseline.availableToHold})`,
    )

    // ─────────────────────────────────────────────────────────────
    // B. MULTI-QUANTITY OVER CAPACITY
    // ─────────────────────────────────────────────────────────────
    console.log('\n[capacity-2] B. MULTI-QUANTITY OVER CAPACITY')
    const oversize = await postHold2('oversize', { quantity: 3 })
    check(oversize.status === 409, `qty=3 over capacity-2 → 409 (got ${oversize.status})`)
    check(oversize.json.error === 'over-capacity', `error code === "over-capacity" (got "${oversize.json.error}")`)
    const stuckOversize = await prisma.bookingItem.count({
      where: { categoryId: cap2Category.id, booking: { jobName: `${CAP2_FIXTURE_PREFIX} oversize` } },
    })
    check(stuckOversize === 0, 'no BookingItem persisted from rejected oversize attempt')

    // ─────────────────────────────────────────────────────────────
    // C. BUFFER-ENCROACHMENT SOFT WARN (qty > freeCount, qty ≤ available)
    // ─────────────────────────────────────────────────────────────
    console.log('\n[capacity-2] C. BUFFER-ENCROACHMENT SOFT WARN')
    const bufferWarn = await postHold2('buffer-soft', { quantity: 2 })
    check(bufferWarn.status === 409, `qty=2 with freeCount=1 + bufferCount=1 → 409 soft warn (got ${bufferWarn.status})`)
    check(
      bufferWarn.json.error === 'buffer-encroachment',
      `error code === "buffer-encroachment" (got "${bufferWarn.json.error}")`,
    )
    check(bufferWarn.json.needsOverride === true, 'response includes needsOverride=true')

    // ─────────────────────────────────────────────────────────────
    // D. BUFFER OVERRIDE SUCCEEDS
    // ─────────────────────────────────────────────────────────────
    console.log('\n[capacity-2] D. BUFFER OVERRIDE SUCCEEDS')
    const bufferForce = await postHold2('buffer-force', { quantity: 2, bufferOverride: true })
    check(
      bufferForce.status === 201 && bufferForce.json.ok === true,
      `qty=2 with bufferOverride=true → 201 (got ${bufferForce.status})`,
    )
    if (bufferForce.status === 201) {
      const bi = bufferForce.json.bookingItem as { id: string; holdRank: number; quantity: number }
      check(bi.holdRank === 1, `forced hold lands at rank 1 (got ${bi.holdRank})`)
      check(bi.quantity === 2, `forced hold quantity preserved (got ${bi.quantity})`)
      check(
        Boolean(bufferForce.json.bufferOverrideUsed),
        `response flags bufferOverrideUsed=true (got ${bufferForce.json.bufferOverrideUsed})`,
      )
    }

    // After the force: 2 units claimed by rank=1 → availableToHold == 0.
    const postForce = await getCategoryAvailability(cap2Category.id, d(TW_START), d(TW_END), 1)
    check(
      postForce.availableToHold === 0,
      `availableToHold === 0 after rank-1 qty=2 hold (got ${postForce.availableToHold})`,
    )

    // ─────────────────────────────────────────────────────────────
    // E. BACKUP HOLD IGNORES BUFFER + CAPACITY
    // ─────────────────────────────────────────────────────────────
    console.log('\n[capacity-2] E. BACKUP HOLD IGNORES BUFFER + CAPACITY')
    const backupAtCap = await postHold2('backup-bypass', { quantity: 1, isBackup: true })
    check(
      backupAtCap.status === 201 && backupAtCap.json.ok === true,
      `rank-2 backup at availableToHold=0 → 201 (got ${backupAtCap.status})`,
    )
    if (backupAtCap.status === 201) {
      const bi = backupAtCap.json.bookingItem as { id: string; holdRank: number }
      check(bi.holdRank === 2, `backup lands at rank 2 (got ${bi.holdRank})`)
    }
    const postBackup = await getCategoryAvailability(cap2Category.id, d(TW_START), d(TW_END), 1)
    check(
      postBackup.availableToHold === 0,
      `availableToHold STILL 0 after backup (got ${postBackup.availableToHold}) — backups must never consume capacity`,
    )
  } finally {
    // Hard cleanup: delete every fixture booking (cascades through to
    // BookingItem + BookingAssignment) AND the anchor.
    await prisma.booking.deleteMany({
      where: {
        OR: [
          { jobName: { startsWith: CAP2_FIXTURE_PREFIX } },
          ...(anchorBookingId ? [{ id: anchorBookingId }] : []),
        ],
      },
    })
  }

  // ── Final summary ──
  console.log('')
  if (failures.length === 0) {
    console.log(`✓ all checks passed`)
    process.exit(0)
  } else {
    console.error(`✗ ${failures.length} failure(s):`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(2)
})
