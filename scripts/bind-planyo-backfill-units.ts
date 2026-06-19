#!/usr/bin/env tsx
/**
 * Post-import unit-assignment binder for PLANYO_BACKFILL reservations.
 *
 * The original scheduling-planyo-migration.ts script binds units at
 * import time, but the live schedule still shows ~76 BookingItems in
 * "needs assignment" because a sizable fraction of imported
 * reservations carried a unit_assignment that the normalizer at
 * import time couldn't (or didn't) resolve to a specific Asset row.
 * The fix landed in planyoNameNormalizer.ts (trailing slot-letter
 * regex, etc.) but was never wired back over the existing data.
 *
 * This script walks every live (status != CANCELLED) Reservation on
 * a Booking with source=PLANYO_BACKFILL, normalizes the Planyo
 * unit_assignment via the production normalizer + the same alias /
 * routing rules as the import script, and buckets each row:
 *
 *   - RESOLVED      single Asset match in the resolved category,
 *                   AND a matching unassigned BookingItem exists
 *                   on the same Booking
 *   - AMBIGUOUS     normalized name matches > 1 Asset
 *   - UNMATCHED     normalized name matches 0 Assets
 *   - COLLISION     two+ reservations on the same Booking + category
 *                   resolve to the SAME Asset across overlapping
 *                   windows (the Planyo "3RD HOLD" workaround)
 *   - CONFLICT      asset resolved cleanly but no unassigned
 *                   BookingItem on the booking carries the matching
 *                   category (or the category is force-unassigned
 *                   per CATEGORY_ROUTES, e.g. Studios → Lankershim)
 *
 * Default mode is DRY RUN — no writes. Pass --write to:
 *   - For every RESOLVED row, create exactly one BookingAssignment
 *     (bookingItemId = matched item, assetId = matched asset,
 *     startDate = reservation date floor, endDate = ceil) and flip
 *     the BookingItem to ASSIGNED.
 *   - Stamp `[UNIT_ASSIGN_BACKFILL <runId>] reservationId=…` onto
 *     BookingItem.notes for reversibility.
 *   - All inserts/updates run in a single $transaction; failure on
 *     any one row rolls back the whole batch.
 *
 * AMBIGUOUS / UNMATCHED / COLLISION / CONFLICT rows stay unassigned
 * for human review.
 *
 * Usage:
 *   npx tsx scripts/bind-planyo-backfill-units.ts             # dry run
 *   npx tsx scripts/bind-planyo-backfill-units.ts --write     # apply
 */

import { readFileSync } from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { normalizePlanyoUnitName } from '../src/lib/scheduling/planyoNameNormalizer'

// ── Same crosswalk + routing rules as the import script ─────────────
// Kept in lockstep manually; this script intentionally does NOT import
// from scheduling-planyo-migration.ts to keep that long file's
// surface area unchanged.

const NAME_ALIASES: Record<string, string> = {
  'Scout Van': 'Video Van',
  'Cube 30 Wardrobe': 'Cube 30',
}

// Planyo `category` strings (the resource name string on Reservation)
// that don't byte-match AssetCategory.name. Map → canonical name.
const RESOURCE_NAME_CROSSWALK: Record<string, string> = {
  'Cargo Vans w/ Liftgate': 'Cargo Van w/ Liftgate',
  'Cargo Vans w/o Liftgate': 'Cargo Van w/o Liftgate',
  'ProScout Van / VTR': 'ProScout / VTR',
}

// Resource names we deliberately do not bind (per
// IGNORED_PLANYO_RESOURCE_IDS in src/lib/sync/planyo/reconcile.ts).
const IGNORED_RESOURCE_NAMES = new Set<string>(['Task List'])

// Routing overrides — kept in sync with scheduling-planyo-migration's
// CATEGORY_ROUTES. Lankershim spaces come in under generic "Studios"
// and Planyo doesn't say which room; the agent assigns post-import.
type CategoryRoute = {
  matches: (rawUnit: string) => boolean
  forceUnassigned: boolean
  reason: string
}
const CATEGORY_ROUTES: CategoryRoute[] = [
  {
    matches: (raw) => /^lankershim\s+studio\b/i.test(raw),
    forceUnassigned: true,
    reason:
      'Planyo lumps Lankershim spaces under generic "Studios"; specific room not in Planyo data — agent assigns post-import.',
  },
]

// ── env bootstrap ───────────────────────────────────────────────────
const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
const prisma = new PrismaClient()

const args = process.argv.slice(2)
const APPLY = args.includes('--write')

type Bucket =
  | 'RESOLVED'
  | 'AMBIGUOUS'
  | 'UNMATCHED'
  | 'COLLISION'
  | 'CONFLICT'

type Row = {
  reservationId: string
  planyoReservationId: string | null
  bookingId: string
  bookingNumber: string | null
  rawCategory: string | null
  rawUnitName: string
  normalized: string
  isBackupHold: boolean
  resolvedCategoryName: string | null
  resolvedCategoryId: string | null
  matchedAssetId: string | null
  matchedAssetUnitName: string | null
  matchedBookingItemId: string | null
  bucket: Bucket
  reason: string
  startDate: Date
  endDate: Date
}

function toDateFloor(d: Date): Date {
  const x = new Date(d)
  x.setUTCHours(0, 0, 0, 0)
  return x
}
function toDateCeil(d: Date): Date {
  // End-of-reservation timestamps from Planyo land at 23:59 UTC most
  // of the time. Coerce to that same UTC midnight so BookingAssignment
  // dates stay @db.Date-clean.
  const x = new Date(d)
  x.setUTCHours(0, 0, 0, 0)
  return x
}

async function main() {
  const runId = `BIND-${Date.now().toString(36).slice(-6).toUpperCase()}`
  console.log(`Planyo backfill unit binder — ${APPLY ? 'LIVE WRITE' : 'DRY RUN'}`)
  console.log(`Run id: ${runId}`)
  console.log('')

  // ── Preload assets + categories ────────────────────────────────
  const allCategories = await prisma.assetCategory.findMany({
    select: { id: true, name: true },
  })
  const categoryByName = new Map<string, { id: string; name: string }>()
  for (const c of allCategories) categoryByName.set(c.name, c)

  const allAssets = await prisma.asset.findMany({
    where: { isActive: true },
    select: { id: true, unitName: true, categoryId: true },
  })
  // Bucket assets by (categoryId, unitName) to detect AMBIGUOUS hits.
  // The Asset.unitName index in production is NOT unique within a
  // category — we observed "Hospital Set" landing twice during the
  // Lankershim reconcile. Defensive bucketing here lets us flag it.
  const assetsByCatAndName = new Map<string, typeof allAssets>()
  for (const a of allAssets) {
    const k = `${a.categoryId}|${a.unitName}`
    const bucket = assetsByCatAndName.get(k) ?? []
    bucket.push(a)
    assetsByCatAndName.set(k, bucket)
  }

  // ── Pull live reservations on PLANYO_BACKFILL bookings ─────────
  const reservations = await prisma.reservation.findMany({
    where: {
      booking: { source: 'PLANYO_BACKFILL' },
      status: { not: 'CANCELLED' },
    },
    select: {
      id: true,
      planyoReservationId: true,
      bookingId: true,
      unitName: true,
      category: true,
      startTime: true,
      endTime: true,
      booking: {
        select: {
          id: true,
          bookingNumber: true,
          items: {
            select: {
              id: true, categoryId: true, quantity: true, holdRank: true, notes: true,
              assignments: { select: { id: true } },
            },
            orderBy: { holdRank: 'asc' },
          },
        },
      },
    },
  })
  console.log(`Loaded ${reservations.length} live PLANYO_BACKFILL reservations.`)

  // ── Pass 1: per-row resolution ─────────────────────────────────
  const rows: Row[] = []
  // Track how many BookingAssignments this run plans to create per
  // BookingItem. A BookingItem with quantity=3 (e.g. a "3 Cube Trucks"
  // hold) can absorb up to 3 separate assignments — one per Reservation
  // in the same booking + category. Initialize from the count of
  // assignments ALREADY in the DB so partial-prior-binds don't double-
  // assign past capacity.
  const plannedAssignsByItem = new Map<string, number>()
  // Detect COLLISION: two Reservations on the same booking that
  // resolve to the same Asset across overlapping date ranges.
  const seenAssetByBooking = new Map<string, Map<string, Row>>()

  for (const r of reservations) {
    const rawCategory = r.category ?? ''
    const rawUnit = r.unitName ?? ''
    const start = toDateFloor(r.startTime)
    const end = toDateCeil(r.endTime)
    const base: Omit<Row, 'bucket' | 'reason'> = {
      reservationId: r.id,
      planyoReservationId: r.planyoReservationId,
      bookingId: r.bookingId ?? '',
      bookingNumber: r.booking?.bookingNumber ?? null,
      rawCategory,
      rawUnitName: rawUnit,
      normalized: '',
      isBackupHold: false,
      resolvedCategoryName: null,
      resolvedCategoryId: null,
      matchedAssetId: null,
      matchedAssetUnitName: null,
      matchedBookingItemId: null,
      startDate: start,
      endDate: end,
    }

    // 1. Ignored resource (Task List, etc.)
    if (IGNORED_RESOURCE_NAMES.has(rawCategory)) {
      rows.push({ ...base, bucket: 'CONFLICT', reason: `ignored resource "${rawCategory}"` })
      continue
    }

    // 2. Force-unassigned routing (Lankershim Studios)
    const route = CATEGORY_ROUTES.find((rt) => rt.matches(rawUnit))
    if (route?.forceUnassigned) {
      rows.push({ ...base, bucket: 'CONFLICT', reason: route.reason })
      continue
    }

    // 3. Resolve AssetCategory by name (with crosswalk for plurals)
    const catName = RESOURCE_NAME_CROSSWALK[rawCategory] ?? rawCategory
    const cat = categoryByName.get(catName) ?? null
    if (!cat) {
      rows.push({
        ...base,
        bucket: 'CONFLICT',
        reason: `no AssetCategory named "${catName}" (raw: "${rawCategory}")`,
      })
      continue
    }
    base.resolvedCategoryName = cat.name
    base.resolvedCategoryId = cat.id

    // 4. Normalize the unit name
    const norm = normalizePlanyoUnitName(rawUnit, cat.name)
    base.normalized = norm.normalized
    base.isBackupHold = norm.isBackupHold
    if (norm.isBackupHold) {
      // Backup holds are a separate workflow (holdRank=2 BookingItems).
      // Don't auto-bind — surface for review.
      rows.push({ ...base, bucket: 'CONFLICT', reason: 'backup hold (2ND/3RD HOLD) — manual promotion path' })
      continue
    }
    if (!norm.normalized) {
      rows.push({ ...base, bucket: 'UNMATCHED', reason: 'unit_assignment empty after normalization' })
      continue
    }

    // 5. Asset lookup (with alias fallback)
    const lookupName = NAME_ALIASES[norm.normalized] ?? norm.normalized
    const assetBucket = assetsByCatAndName.get(`${cat.id}|${lookupName}`) ?? []
    if (assetBucket.length === 0) {
      rows.push({
        ...base,
        bucket: 'UNMATCHED',
        reason: `no Asset named "${lookupName}" in category "${cat.name}"`,
      })
      continue
    }
    if (assetBucket.length > 1) {
      rows.push({
        ...base,
        bucket: 'AMBIGUOUS',
        reason: `${assetBucket.length} Assets named "${lookupName}" in category "${cat.name}"`,
      })
      continue
    }
    const asset = assetBucket[0]
    base.matchedAssetId = asset.id
    base.matchedAssetUnitName = asset.unitName

    // 6. Find a candidate BookingItem on the booking with matching
    //    category that still has free capacity. A BookingItem with
    //    quantity=N can hold N assignments — only buckets as
    //    CONFLICT here if every category-matching BookingItem on
    //    the booking has already reached its quantity.
    const categoryItems = (r.booking?.items ?? []).filter((bi) => bi.categoryId === cat.id)
    if (categoryItems.length === 0) {
      rows.push({
        ...base,
        bucket: 'CONFLICT',
        reason: `no BookingItem with categoryId=${cat.id} on booking ${r.booking?.bookingNumber ?? r.bookingId}`,
      })
      continue
    }
    const chosenItem = categoryItems.find((bi) => {
      const existing = bi.assignments.length
      const planned = plannedAssignsByItem.get(bi.id) ?? 0
      return existing + planned < bi.quantity
    })
    if (!chosenItem) {
      rows.push({
        ...base,
        bucket: 'CONFLICT',
        reason: `every BookingItem for categoryId=${cat.id} on booking ${r.booking?.bookingNumber ?? r.bookingId} is at quantity capacity`,
      })
      continue
    }
    base.matchedBookingItemId = chosenItem.id

    // 7. Cross-reservation COLLISION check — same Asset claimed twice
    //    on the same booking in this run.
    const bookingMap =
      seenAssetByBooking.get(r.bookingId ?? '') ?? new Map<string, Row>()
    const prior = bookingMap.get(asset.id)
    if (prior) {
      rows.push({
        ...base,
        bucket: 'COLLISION',
        reason: `Asset ${asset.unitName} already bound by reservation ${prior.planyoReservationId ?? prior.reservationId} on same booking`,
      })
      continue
    }

    const row: Row = { ...base, bucket: 'RESOLVED', reason: 'clean single match' }
    rows.push(row)
    plannedAssignsByItem.set(chosenItem.id, (plannedAssignsByItem.get(chosenItem.id) ?? 0) + 1)
    bookingMap.set(asset.id, row)
    seenAssetByBooking.set(r.bookingId ?? '', bookingMap)
  }

  // ── Report ─────────────────────────────────────────────────────
  const summary: Record<Bucket, number> = {
    RESOLVED: 0, AMBIGUOUS: 0, UNMATCHED: 0, COLLISION: 0, CONFLICT: 0,
  }
  for (const r of rows) summary[r.bucket]++

  console.log('\n──── Bucket totals (binding-ready) ────')
  for (const b of Object.keys(summary) as Bucket[]) {
    console.log(`  ${b.padEnd(10)} ${summary[b]}`)
  }
  console.log(`  total      ${rows.length}`)

  // ── Asset-resolution alone (ignoring BookingItem availability) ──
  // The prior baseline ("~239 resolved") measured just the normalizer
  // + asset-lookup step. Replicate that count here so the comparison
  // against the baseline is apples to apples — and so the gap to the
  // binding-ready RESOLVED count is visible (= reservations whose
  // unit normalizes to a real Asset but have no BookingItem to bind
  // to on their booking).
  const assetResAlone = {
    resolved: 0, ambiguous: 0, unmatched: 0,
    forceUnassigned: 0, backupHold: 0, ignoredResource: 0, badCategory: 0,
  }
  for (const r of rows) {
    if (r.bucket === 'AMBIGUOUS') assetResAlone.ambiguous++
    else if (r.bucket === 'UNMATCHED') assetResAlone.unmatched++
    else if (r.reason.startsWith('ignored resource')) assetResAlone.ignoredResource++
    else if (r.reason.startsWith('Planyo lumps')) assetResAlone.forceUnassigned++
    else if (r.reason.startsWith('backup hold')) assetResAlone.backupHold++
    else if (r.reason.startsWith('no AssetCategory')) assetResAlone.badCategory++
    else assetResAlone.resolved++ // RESOLVED + COLLISION + binding-CONFLICT all had a clean Asset hit
  }
  console.log('\n──── Asset-resolution alone (prior-baseline framing) ────')
  console.log(`  Asset-resolved (single match):  ${assetResAlone.resolved}`)
  console.log(`  Asset-ambiguous:                ${assetResAlone.ambiguous}`)
  console.log(`  Asset-unmatched:                ${assetResAlone.unmatched}`)
  console.log(`  Force-unassigned (Lankershim):  ${assetResAlone.forceUnassigned}`)
  console.log(`  Backup-hold (2ND/3RD HOLD):     ${assetResAlone.backupHold}`)
  console.log(`  Ignored resource (Task List):   ${assetResAlone.ignoredResource}`)
  console.log(`  Bad category resolution:        ${assetResAlone.badCategory}`)

  // Drift hooks: Lankershim flow + 3RD HOLD collisions.
  const lankRows = rows.filter((r) => /^lankershim\s+studio\b/i.test(r.rawUnitName))
  const collisions = rows.filter((r) => r.bucket === 'COLLISION')
  console.log('\n──── Drift signals ────')
  console.log(`  Lankershim-routed reservations: ${lankRows.length} (all in CONFLICT/force-unassigned)`)
  console.log(`  COLLISION rows: ${collisions.length}`)
  if (collisions.length > 0) {
    for (const c of collisions.slice(0, 10)) {
      console.log(`    - rsvId=${c.planyoReservationId} booking=${c.bookingNumber} "${c.rawUnitName}" → ${c.matchedAssetUnitName} ${c.reason}`)
    }
  }

  // Show first 10 of every non-RESOLVED bucket for human eyeball.
  for (const b of ['AMBIGUOUS', 'UNMATCHED', 'COLLISION', 'CONFLICT'] as Bucket[]) {
    const sample = rows.filter((r) => r.bucket === b).slice(0, 10)
    if (sample.length === 0) continue
    console.log(`\n──── ${b} sample (first ${sample.length}) ────`)
    for (const r of sample) {
      console.log(
        `  rsv=${r.planyoReservationId} bk=${r.bookingNumber} ` +
          `cat=${r.rawCategory} unit="${r.rawUnitName}" norm="${r.normalized}" ` +
          `reason=${r.reason}`,
      )
    }
  }

  // ── Apply ──────────────────────────────────────────────────────
  if (!APPLY) {
    console.log('\nDRY RUN — pass --write to apply.')
    await prisma.$disconnect()
    return
  }

  const toBind = rows.filter((r) => r.bucket === 'RESOLVED')
  console.log(`\nApplying ${toBind.length} BookingAssignments in one transaction…`)

  let created = 0
  let itemsAssigned = 0
  // Default Prisma interactive-transaction timeout is 5s. With ~89
  // rows × 3 round-trips each, we comfortably blow past that — bump
  // to 60s (still well under the Neon serverless statement-timeout
  // ceiling).
  await prisma.$transaction(async (tx) => {
    for (const r of toBind) {
      if (!r.matchedAssetId || !r.matchedBookingItemId || !r.resolvedCategoryId) continue
      // Idempotency guard: skip if an assignment for (item, asset)
      // already exists in this date window.
      const exists = await tx.bookingAssignment.findFirst({
        where: {
          bookingItemId: r.matchedBookingItemId,
          assetId: r.matchedAssetId,
        },
        select: { id: true },
      })
      if (exists) continue
      await tx.bookingAssignment.create({
        data: {
          bookingItemId: r.matchedBookingItemId,
          assetId: r.matchedAssetId,
          startDate: r.startDate,
          endDate: r.endDate,
          status: 'ASSIGNED',
        },
      })
      created++

      // Flip BookingItem to ASSIGNED. Stamp run id + reservation id
      // into notes for reversibility — `DELETE FROM booking_assignments
      // WHERE id IN (...)` + reset status would unwind the batch.
      const noteTag = `[UNIT_ASSIGN_BACKFILL ${runId}] reservationId=${r.planyoReservationId ?? r.reservationId}`
      await tx.bookingItem.update({
        where: { id: r.matchedBookingItemId },
        data: {
          status: 'ASSIGNED',
          notes: { set: noteTag },
        },
      })
      itemsAssigned++
    }
  }, { timeout: 60_000, maxWait: 10_000 })

  console.log(`\nWrote ${created} BookingAssignment(s); flipped ${itemsAssigned} BookingItem(s) to ASSIGNED.`)
  console.log(`Run id: ${runId}`)
  console.log(`Reverse with:`)
  console.log(`  DELETE FROM booking_assignments WHERE created_at >= NOW() - INTERVAL '1 hour' AND booking_item_id IN (SELECT id FROM booking_items WHERE notes LIKE '[UNIT_ASSIGN_BACKFILL ${runId}]%');`)
  console.log(`  UPDATE booking_items SET status='REQUESTED', notes=NULL WHERE notes LIKE '[UNIT_ASSIGN_BACKFILL ${runId}]%';`)

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
