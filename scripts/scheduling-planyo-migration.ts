#!/usr/bin/env tsx
/**
 * Chunk 7 of native-scheduling-v1-brief.md — Planyo → native one-time
 * migration. Pulls the forward book from Planyo (list_reservations,
 * detail_level=3), and for each reservation:
 *
 *   1. Find or create Company by name (with suffix-stripped fuzzy
 *      match: "Fulu Films" ≡ "Fulu Films LLC").
 *   2. Find or create Person by email (or first+last fallback).
 *   3. Group Planyo reservations by cart_id; one Booking per cart.
 *   4. One BookingItem per reservation in the cart (qty=1, dailyRate
 *      from the matched AssetCategory).
 *   5. Resolve unit_assignment → Asset by exact unitName within the
 *      category. If matched, create a BookingAssignment(status=ASSIGNED)
 *      and the BookingItem flips to ASSIGNED. If not matched, leave
 *      the BookingItem at REQUESTED so it surfaces in /stale-holds
 *      and the report lists the unmatched unit.
 *
 * Idempotency: uses the existing Reservation table as an import
 * journal. Reservations with a non-null bookingId are skipped; new
 * ones get a Reservation row written pointing at the new Booking.
 * Re-running is safe.
 *
 * Reports unmatched Planyo resource names (no AssetCategory with that
 * planyoResourceId) and unmatched unit_assignment strings (no Asset
 * with that unitName in the category) — the brief: "Log unmatched
 * units/resources to a report rather than failing."
 *
 * Usage:
 *   npx tsx scripts/scheduling-planyo-migration.ts                     # dry run
 *   npx tsx scripts/scheduling-planyo-migration.ts --write              # actually persist
 *   npx tsx scripts/scheduling-planyo-migration.ts --days 180           # forward window
 *   npx tsx scripts/scheduling-planyo-migration.ts --default-agent=wes@sirreel.com
 */

import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { PrismaClient, type BookingStatus } from '@prisma/client'
import { normalizePlanyoUnitName } from '../src/lib/scheduling/planyoNameNormalizer'

// ──────────────────────────────────────────────────────────────
// Reconciliation maps — see scheduling-add-missing-assets.ts for
// the canonical narrative of each entry.
// ──────────────────────────────────────────────────────────────

/**
 * Post-normalization aliases: two distinct Planyo names that resolve
 * to the SAME physical Asset. Map: normalized form → canonical
 * Asset.unitName to look up.
 *
 * Every aliased hit is listed in the report so the operator can
 * confirm the alias is correct before --write.
 */
const NAME_ALIASES: Record<string, string> = {
  'Scout Van': 'Video Van',
  'Cube 30 Wardrobe': 'Cube 30',
}

/**
 * Category routing overrides: certain Planyo unit_assignment values
 * should route to a different AssetCategory than the one
 * Planyo's resource_id maps to. Used today for "Lankershim Studio"
 * reservations — Planyo lumps them under the generic "Studios"
 * resource, but they belong in the new "Lankershim Studios" category.
 */
interface CategoryRoute {
  matches: (rawUnitName: string) => boolean
  targetCategoryName: string
  routeReason: string
  /** True iff this routing should suppress the asset-match step
   *  (forcing the BookingItem to stay REQUESTED for manual
   *  per-room assignment). */
  forceUnassigned?: boolean
  /** Bucket label in the review-list section of the report. */
  reviewBucket: 'lankershimRoomNeeded' | 'sprinterUnassigned'
}

const CATEGORY_ROUTES: CategoryRoute[] = [
  {
    matches: (raw) => /^lankershim\s+studio\b/i.test(raw),
    targetCategoryName: 'Lankershim Studios',
    routeReason:
      'Planyo lumps Lankershim spaces under generic "Studios"; routed to new Lankershim Studios category. Specific room not in Planyo data — agent assigns post-import.',
    forceUnassigned: true,
    reviewBucket: 'lankershimRoomNeeded',
  },
]

/**
 * In-category unassigned overrides: kept around for future use, but
 * currently EMPTY. The previous Sprinter rule was removed on
 * 2026-05-23 once fleet confirmed Sprinter #1/#2/#4 are three
 * distinct Cargo-w-Liftgate units with their own Asset rows
 * (created by scheduling-add-missing-assets.ts). The Planyo names
 * "Sprinter #N (A)" now normalize to "Sprinter N" and bind to
 * those assets directly.
 */
interface UnassignedRule {
  matches: (rawUnitName: string) => boolean
  reason: string
  reviewBucket: 'sprinterUnassigned' | 'lankershimRoomNeeded'
}

const FORCE_UNASSIGNED_IN_CATEGORY: UnassignedRule[] = []

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const prisma = new PrismaClient()

// ─── Flags ────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const dryRun = !args.includes('--write')
const daysArg = args.find((a) => a.startsWith('--days='))?.split('=')[1] ?? args[args.indexOf('--days') + 1]
const FORWARD_DAYS = Math.max(1, parseInt(daysArg || '180', 10) || 180)
const defaultAgentEmailArg = args.find((a) => a.startsWith('--default-agent='))?.split('=')[1]
const DEFAULT_AGENT_EMAIL = defaultAgentEmailArg || 'wes@sirreel.com'

// ─── Planyo client ────────────────────────────────────────────────
const PLANYO_BASE = 'https://www.planyo.com/rest/'
const PLANYO_API_KEY = process.env.PLANYO_API_KEY || ''
const PLANYO_SITE_ID = process.env.PLANYO_SITE_ID || '36171'

async function planyo(method: string, params: Record<string, string> = {}) {
  if (!PLANYO_API_KEY) throw new Error('PLANYO_API_KEY missing from .env.local')
  const url = new URL(PLANYO_BASE)
  url.searchParams.set('method', method)
  url.searchParams.set('api_key', PLANYO_API_KEY)
  url.searchParams.set('site_id', PLANYO_SITE_ID)
  url.searchParams.set('format', 'json')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  return res.json()
}

// ─── Helpers ──────────────────────────────────────────────────────
function normalize(s: string | null | undefined): string {
  if (!s) return ''
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}
const COMPANY_SUFFIX_RE = /\b(llc|l\.l\.c|inc|inc\.|corp|corporation|co|co\.|ltd|ltd\.|limited|llp|pllc|pc|p\.c)\b/gi
function companyKey(s: string | null | undefined): string {
  if (!s) return ''
  const stripped = s.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ').replace(COMPANY_SUFFIX_RE, ' ')
  return normalize(stripped)
}
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}
function mapPlanyoStatus(code: string | number | undefined): { booking: BookingStatus; isCancelled: boolean } {
  const s = typeof code === 'string' ? parseInt(code, 10) : code ?? 0
  if (s === 2) return { booking: 'CANCELLED', isCancelled: true }
  if (s === 11 || s === 4) return { booking: 'CONFIRMED', isCancelled: false }
  if (s === 8) return { booking: 'PENDING_APPROVAL', isCancelled: false }
  return { booking: 'REQUEST', isCancelled: false }
}

// ─── Planyo reservation shape (loose, hand-validated against payload) ─
interface PlanyoReservation {
  reservation_id: string | number
  cart_id?: string | number
  name?: string // resource (category) name
  resource_id?: string | number
  unit_assignment?: string
  start_time?: string
  end_time?: string
  status?: string | number
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  user_notes?: string
  admin_notes?: string
  quantity?: string | number
  properties?: { Company_Name?: string; Job_Name?: string; SirReel_Agent?: string }
}

// ─── Main ─────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date()
  console.log(`Planyo → native scheduling migration — ${dryRun ? 'DRY RUN' : 'LIVE WRITE'}`)
  console.log(`Forward window: ${FORWARD_DAYS} days`)
  console.log(`Default agent fallback: ${DEFAULT_AGENT_EMAIL}`)
  console.log('')

  // ── Default agent ──
  const defaultAgent = await prisma.user.findUnique({
    where: { email: DEFAULT_AGENT_EMAIL },
    select: { id: true, name: true, email: true },
  })
  if (!defaultAgent) throw new Error(`Default agent ${DEFAULT_AGENT_EMAIL} not found in users`)

  // ── Pre-load AssetCategory + Asset for matching ──
  const allCategories = await prisma.assetCategory.findMany({
    select: { id: true, name: true, slug: true, planyoResourceId: true, dailyRate: true },
  })
  const categoryByPlanyoId = new Map<number, (typeof allCategories)[number]>()
  for (const c of allCategories) {
    if (c.planyoResourceId !== null) categoryByPlanyoId.set(c.planyoResourceId, c)
  }
  const allAssets = await prisma.asset.findMany({
    where: { isActive: true },
    select: { id: true, unitName: true, categoryId: true, status: true },
  })
  // keyed by (categoryId|unitName) for exact match.
  const assetByCategoryAndName = new Map<string, (typeof allAssets)[number]>()
  for (const a of allAssets) {
    assetByCategoryAndName.set(`${a.categoryId}|${a.unitName}`, a)
  }

  // ── Pre-load Companies / Persons for find-or-create ──
  const allCompanies = await prisma.company.findMany({ select: { id: true, name: true } })
  const companyByKey = new Map<string, { id: string; name: string }>()
  const companyByNorm = new Map<string, { id: string; name: string }>()
  for (const c of allCompanies) {
    const k = companyKey(c.name); const n = normalize(c.name)
    if (k && !companyByKey.has(k)) companyByKey.set(k, c)
    if (n && !companyByNorm.has(n)) companyByNorm.set(n, c)
  }
  const allPersons = await prisma.person.findMany({ select: { id: true, firstName: true, lastName: true, email: true } })
  const personByEmail = new Map<string, (typeof allPersons)[number]>()
  for (const p of allPersons) if (p.email) personByEmail.set(p.email.toLowerCase(), p)

  // ── Dedup ledger: existing Reservation.planyoReservationId where bookingId set ──
  const importedReservations = await prisma.reservation.findMany({
    where: { bookingId: { not: null }, planyoReservationId: { not: null } },
    select: { planyoReservationId: true },
  })
  const alreadyImported = new Set(importedReservations.map((r) => r.planyoReservationId!))
  console.log(`Already-imported Planyo reservation_ids (from Reservation journal): ${alreadyImported.size}`)

  // ── One-shot Booking.planyoCartId backfill from Reservation journal. ──
  //
  // The schema field was added 2026-05-22 to make this script
  // cart-level idempotent. Existing PLANYO_BACKFILL bookings created
  // before that change don't carry a cart id directly — but their
  // Reservation journal rows do. Stamp it back so future re-runs
  // can find them via planyoCartId lookup and append to instead of
  // duplicating them.
  //
  // Idempotent: WHERE bookings.planyo_cart_id IS NULL means each row
  // is touched at most once across runs. Live-write only — dry-run
  // skips so the report stays purely observational.
  let backfilledCartIds = 0
  if (!dryRun) {
    const result = await prisma.$executeRaw`
      UPDATE bookings
      SET planyo_cart_id = sub.planyo_cart_id,
          updated_at = NOW()
      FROM (
        SELECT DISTINCT ON (booking_id) booking_id, planyo_cart_id
        FROM reservations
        WHERE booking_id IS NOT NULL AND planyo_cart_id IS NOT NULL
      ) sub
      WHERE bookings.id = sub.booking_id
        AND bookings.planyo_cart_id IS NULL
    `
    backfilledCartIds = Number(result)
    if (backfilledCartIds > 0) {
      console.log(`Backfilled planyo_cart_id on ${backfilledCartIds} existing Booking row(s) from Reservation journal.`)
    }
  }

  // ── Build a planyoCartId → existing Booking map so cart-level
  //    idempotency works for THIS run. Carts that already have a
  //    Booking get NEW reservations appended as BookingItems on the
  //    same Booking instead of spawning a duplicate. ──
  //
  // Dry-run note: the backfill UPDATE above is live-only, so in
  // dry-run mode we ALSO consult the Reservation journal to
  // synthesize the lookup map as if the backfill had run. Without
  // this, dry-run would always report 0 cart-appends and the
  // preview would be useless for verifying idempotency.
  type BookingByCart = { id: string; planyoCartId: string | null; bookingNumber: string; startDate: Date; endDate: Date }
  const bookingByCartId = new Map<string, BookingByCart>()

  const directlyStamped = await prisma.booking.findMany({
    where: { planyoCartId: { not: null } },
    select: { id: true, planyoCartId: true, bookingNumber: true, startDate: true, endDate: true },
  })
  for (const b of directlyStamped) if (b.planyoCartId) bookingByCartId.set(b.planyoCartId, b)

  if (dryRun) {
    // Synthesize: any Booking whose Reservation journal carries a
    // cart_id but the Booking itself doesn't (= what the backfill
    // would stamp on a live run).
    type JournalRow = { bookingId: string; planyoCartId: string; bookingNumber: string; startDate: Date; endDate: Date }
    const rawRows = await prisma.$queryRaw<JournalRow[]>`
      SELECT DISTINCT ON (b.id)
        b.id AS "bookingId",
        r.planyo_cart_id AS "planyoCartId",
        b.booking_number AS "bookingNumber",
        b.start_date AS "startDate",
        b.end_date AS "endDate"
      FROM bookings b
      JOIN reservations r ON r.booking_id = b.id
      WHERE b.planyo_cart_id IS NULL
        AND r.planyo_cart_id IS NOT NULL
    `
    for (const r of rawRows) {
      if (!bookingByCartId.has(r.planyoCartId)) {
        bookingByCartId.set(r.planyoCartId, {
          id: r.bookingId, planyoCartId: r.planyoCartId,
          bookingNumber: r.bookingNumber, startDate: r.startDate, endDate: r.endDate,
        })
      }
    }
    console.log(`Existing Bookings with cartId (direct: ${directlyStamped.length} · journal-simulated: ${rawRows.length}): ${bookingByCartId.size} total`)
  } else {
    console.log(`Existing Bookings with planyoCartId stamped: ${bookingByCartId.size}`)
  }

  // ── Pull Planyo forward book ──
  const from = new Date(); from.setUTCHours(0, 0, 0, 0)
  const to = new Date(from.getTime() + FORWARD_DAYS * 86_400_000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10) + ' 00:00:00'
  const data = await planyo('list_reservations', {
    start_time: fmt(from),
    end_time: fmt(to),
    detail_level: '3',
    results_per_page: '500',
  })
  if (data.response_code !== 0) throw new Error(`Planyo error: ${data.response_message}`)
  const reservations = (data.data?.results ?? []) as PlanyoReservation[]
  console.log(`Pulled ${reservations.length} Planyo reservation rows in window ${fmt(from)} → ${fmt(to)}`)

  // ── Group by cart ──
  const cartMap = new Map<string, PlanyoReservation[]>()
  for (const r of reservations) {
    const key = String(r.cart_id ?? `r:${r.reservation_id}`)
    const arr = cartMap.get(key) ?? []
    arr.push(r)
    cartMap.set(key, arr)
  }
  console.log(`Distinct carts: ${cartMap.size}`)
  console.log('')

  // ── Counters / report ──
  interface ReviewListItem {
    cartId: string
    reservationId: string
    planyoUnitName: string
    targetCategory: string
    startDate: string
    endDate: string
    note?: string
  }
  const report = {
    cartsProcessed: 0,
    cartsSkippedFullyImported: 0,
    cartsSkippedAllCancelled: 0,
    /** Carts that had an existing Booking (matched by planyoCartId)
     *  and got new reservations APPENDED rather than spawning a
     *  duplicate Booking. Counts the new "drift" handling path. */
    cartsAppendedToExisting: 0,
    bookingsCreated: 0,
    bookingItemsCreated: 0,
    bookingAssignmentsCreated: 0,
    reservationJournalRowsCreated: 0,
    companiesCreated: 0,
    personsCreated: 0,
    skippedReservationsAlreadyImported: 0,
    skippedReservationsCancelled: 0,
    unmatchedResources: new Map<string, { count: number; sampleUnits: string[] }>(),
    unmatchedUnits: new Map<string, { count: number; resourceName: string; sampleCarts: string[] }>(),
    errors: [] as { cart: string; error: string }[],
    // Per-bucket review lists for the Part-A/B reconciliation work.
    sprinterUnassigned: [] as ReviewListItem[],
    lankershimRoomNeeded: [] as ReviewListItem[],
    backupHoldsNeedLinkage: [] as ReviewListItem[],
    aliasedAssetLookups: [] as Array<{
      cartId: string
      reservationId: string
      planyoUnitName: string
      aliasedTo: string
      categoryName: string
    }>,
  }

  let bookingSeq = 0
  const yearPrefix = new Date().getUTCFullYear()
  const yearStart = new Date(`${yearPrefix}-01-01T00:00:00.000Z`)
  bookingSeq = await prisma.booking.count({ where: { createdAt: { gte: yearStart } } })

  // ── Process each cart ──
  for (const [cartId, rows] of cartMap) {
    report.cartsProcessed++

    // Skip carts fully imported already.
    const unimportedRows = rows.filter((r) => !alreadyImported.has(String(r.reservation_id)))
    const importedRows = rows.length - unimportedRows.length
    if (importedRows > 0) report.skippedReservationsAlreadyImported += importedRows
    if (unimportedRows.length === 0) {
      report.cartsSkippedFullyImported++
      continue
    }
    // Skip carts where every remaining row is cancelled.
    const liveRows = unimportedRows.filter((r) => !mapPlanyoStatus(r.status).isCancelled)
    report.skippedReservationsCancelled += unimportedRows.length - liveRows.length
    if (liveRows.length === 0) {
      report.cartsSkippedAllCancelled++
      continue
    }

    const head = liveRows[0]
    const fullName = `${head.first_name ?? ''} ${head.last_name ?? ''}`.trim()
    const companyDisplay = (head.properties?.Company_Name ?? '').trim() || fullName || 'Unknown Company'
    const startMs = Math.min(...liveRows.map((r) => Date.parse((r.start_time ?? '').replace(' ', 'T') + 'Z')))
    const endMs = Math.max(...liveRows.map((r) => Date.parse((r.end_time ?? '').replace(' ', 'T') + 'Z')))
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      report.errors.push({ cart: cartId, error: 'Unparseable start/end_time' })
      continue
    }
    const startDate = new Date(startMs); startDate.setUTCHours(0, 0, 0, 0)
    const endDate = new Date(endMs); endDate.setUTCHours(0, 0, 0, 0)
    const jobName = (head.properties?.Job_Name ?? '').trim() || `Planyo import — cart ${cartId}`
    const productionName = head.properties?.Job_Name?.trim() || null
    const planyoStatuses = liveRows.map((r) => mapPlanyoStatus(r.status).booking)
    const bookingStatus: BookingStatus =
      planyoStatuses.every((s) => s === 'CONFIRMED') ? 'CONFIRMED' :
      planyoStatuses.every((s) => s === 'PENDING_APPROVAL') ? 'PENDING_APPROVAL' :
      'REQUEST'

    // ── Company resolve ──
    const cKey = companyKey(companyDisplay)
    const cNorm = normalize(companyDisplay)
    let company = companyByKey.get(cKey) ?? companyByNorm.get(cNorm) ?? null
    if (!company) {
      if (dryRun) {
        company = { id: 'DRY-NEW-COMPANY', name: companyDisplay }
      } else {
        const created = await prisma.company.create({
          data: { name: companyDisplay, notes: `Auto-created by Planyo migration on ${startedAt.toISOString().slice(0, 10)}` },
          select: { id: true, name: true },
        })
        companyByKey.set(cKey, created); companyByNorm.set(cNorm, created)
        company = created
      }
      report.companiesCreated++
    }

    // ── Person resolve. Person.firstName/lastName/email are all
    //    non-nullable (and email is @unique). When Planyo doesn't
    //    give us an email, synthesize a stable placeholder keyed on
    //    cart_id so re-runs don't double-create. ──
    const emailLower = (head.email ?? '').trim().toLowerCase()
    let person = emailLower ? personByEmail.get(emailLower) ?? null : null
    if (!person) {
      if (!fullName) {
        report.errors.push({ cart: cartId, error: 'No name OR email to derive a Person from' })
        continue
      }
      const { firstName, lastName } = splitName(fullName)
      const placeholderEmail = emailLower || `planyo-cart-${cartId}@unknown.local`
      const personData = {
        firstName: firstName || fullName,
        lastName: lastName || '—',
        email: placeholderEmail,
        phone: head.phone?.trim() || null,
        notes: `Auto-created by Planyo migration on ${startedAt.toISOString().slice(0, 10)}`,
      }
      if (!dryRun) {
        const created = await prisma.person.create({ data: personData, select: { id: true, firstName: true, lastName: true, email: true } })
        personByEmail.set(created.email.toLowerCase(), created)
        person = created
      } else {
        person = { id: 'DRY-NEW-PERSON', firstName: personData.firstName, lastName: personData.lastName, email: personData.email }
      }
      report.personsCreated++
    }

    // ── Agent resolve — for now everyone defaults to the fallback agent ──
    const agentId = defaultAgent.id

    // ── Parse the RentalWorks order number from user_notes (same
    //    `#NNNNN` pattern the existing /api/timeline route extracts).
    //    Stamped on Booking.rentalworksOrderId so the timeline-shadow
    //    page can pair Planyo↔native rows on a stable key. ──
    const userNotes = (head.user_notes ?? '').toString()
    const rwOrderMatch = userNotes.match(/#(\d+)/)
    const rentalworksOrderId = rwOrderMatch ? rwOrderMatch[1] : null

    // ── Booking — CART-LEVEL UPSERT ──
    //
    // Look up any existing Booking already stamped with this Planyo
    // cartId. If found, REUSE it (this is the new-reservation-on-
    // existing-cart scenario — append BookingItems below, don't
    // create a duplicate Booking). Otherwise create fresh and stamp
    // planyoCartId on the new row for future re-runs.
    const existingBookingForCart = bookingByCartId.get(String(cartId)) ?? null
    let bookingId = 'DRY-NEW-BOOKING'
    let isAppendingToExisting = false

    if (existingBookingForCart) {
      bookingId = existingBookingForCart.id
      isAppendingToExisting = true
      report.cartsAppendedToExisting++
    } else {
      bookingSeq++
      const bookingNumber = `SR-${yearPrefix}-${String(bookingSeq).padStart(4, '0')}`
      try {
        if (!dryRun) {
          const created = await prisma.booking.create({
            data: {
              bookingNumber, companyId: company.id, personId: person.id, agentId,
              jobName, productionName, startDate, endDate,
              status: bookingStatus, source: 'PLANYO_BACKFILL',
              rentalworksOrderId,
              planyoCartId: String(cartId),
              notes: `Imported from Planyo cart ${cartId} on ${startedAt.toISOString().slice(0, 10)}`,
            },
            select: { id: true, bookingNumber: true, planyoCartId: true, startDate: true, endDate: true },
          })
          bookingId = created.id
          // Stamp the lookup map so any further cart-additions in the
          // same run reuse this Booking.
          bookingByCartId.set(String(cartId), {
            id: created.id, planyoCartId: created.planyoCartId, bookingNumber: created.bookingNumber,
            startDate: created.startDate, endDate: created.endDate,
          })
        }
        report.bookingsCreated++
      } catch (e) {
        report.errors.push({ cart: cartId, error: `booking.create: ${(e as Error).message.slice(0, 120)}` })
        continue
      }
    }

    // Pre-resolve category lookup by name for CATEGORY_ROUTES.
    const categoryByName = new Map<string, (typeof allCategories)[number]>()
    for (const c of allCategories) categoryByName.set(c.name, c)

    // ── BookingItems + Assignments + Reservation journal ──
    for (const r of liveRows) {
      const resourceId = typeof r.resource_id === 'string' ? parseInt(r.resource_id, 10) : (r.resource_id ?? 0)
      let category = categoryByPlanyoId.get(resourceId) ?? null
      const resourceName = (r.name ?? '').trim() || `resource:${resourceId}`
      const rawUnit = (r.unit_assignment ?? '').trim()

      // ── Apply CATEGORY_ROUTES override (e.g., Lankershim Studio
      //    reservations → Lankershim Studios category regardless of
      //    Planyo's "Studios" resource_id). ──
      let routeOverride: CategoryRoute | null = null
      for (const route of CATEGORY_ROUTES) {
        if (route.matches(rawUnit)) {
          const target = categoryByName.get(route.targetCategoryName)
          if (target) {
            category = target
            routeOverride = route
          } else {
            // Target doesn't exist yet — fall through and let the
            // unmatched-resource path log it, so the operator sees
            // they need to run scheduling-add-missing-assets first.
            report.errors.push({
              cart: cartId,
              error: `CATEGORY_ROUTES target "${route.targetCategoryName}" not found — run scheduling-add-missing-assets --write first`,
            })
          }
          break
        }
      }

      if (!category) {
        const slot = report.unmatchedResources.get(resourceName) ?? { count: 0, sampleUnits: [] }
        slot.count++
        if (r.unit_assignment && slot.sampleUnits.length < 3 && !slot.sampleUnits.includes(r.unit_assignment)) {
          slot.sampleUnits.push(r.unit_assignment)
        }
        report.unmatchedResources.set(resourceName, slot)
        // Still write a journal row so re-runs skip this.
        if (!dryRun) {
          await prisma.reservation.upsert({
            where: { planyoReservationId: String(r.reservation_id) },
            create: {
              planyoReservationId: String(r.reservation_id), planyoCartId: String(cartId),
              bookingId, unitName: r.unit_assignment ?? '(unmatched-resource)', category: resourceName,
              startTime: new Date(Date.parse((r.start_time ?? '').replace(' ', 'T') + 'Z')),
              endTime: new Date(Date.parse((r.end_time ?? '').replace(' ', 'T') + 'Z')),
              status: 'CONFIRMED', source: 'PLANYO',
              notes: `Unmatched resource ${resourceName} — BookingItem not created`,
            },
            update: { bookingId },
          })
          report.reservationJournalRowsCreated++
        }
        continue
      }

      // ── Determine if this reservation should be force-unassigned. ──
      const inCategoryUnassigned = FORCE_UNASSIGNED_IN_CATEGORY.find((rule) => rule.matches(rawUnit)) ?? null
      const forceUnassigned = Boolean(routeOverride?.forceUnassigned) || Boolean(inCategoryUnassigned)
      const reviewBucket = routeOverride?.reviewBucket ?? inCategoryUnassigned?.reviewBucket ?? null

      // ── Normalize the Planyo unit name up front — we need the
      //    isBackupHold flag to decide BookingItem.holdRank at
      //    create time, and the normalized form for the asset match
      //    afterwards. ──
      const norm = normalizePlanyoUnitName(rawUnit, category.name)
      // Per-reservation dates (not the cart envelope). Earlier versions
      // of this script used the cart-level MIN/MAX (startDate/endDate
      // above) for BookingAssignment writes — that over-stretched
      // assignments to the envelope, marking assets busy across days
      // they weren't actually held. Each Planyo reservation carries
      // its own start_time/end_time; use those for the assignment and
      // for per-reservation report rows.
      const resStartMs = Date.parse((r.start_time ?? '').replace(' ', 'T') + 'Z')
      const resEndMs = Date.parse((r.end_time ?? '').replace(' ', 'T') + 'Z')
      if (!Number.isFinite(resStartMs) || !Number.isFinite(resEndMs)) {
        report.errors.push({ cart: cartId, error: `Unparseable reservation ${r.reservation_id} start/end_time` })
        continue
      }
      const resStart = new Date(resStartMs); resStart.setUTCHours(0, 0, 0, 0)
      const resEnd = new Date(resEndMs); resEnd.setUTCHours(0, 0, 0, 0)
      const startDateISO = resStart.toISOString().slice(0, 10)
      const endDateISO = resEnd.toISOString().slice(0, 10)
      const itemHoldRank = norm.isBackupHold ? 2 : 1

      let bookingItemId = ''
      try {
        if (!dryRun) {
          const item = await prisma.bookingItem.create({
            data: {
              bookingId, categoryId: category.id, quantity: 1, dailyRate: category.dailyRate,
              status: 'REQUESTED', holdRank: itemHoldRank,
              notes: norm.isBackupHold
                ? 'Backup hold from Planyo "X - 2ND HOLD" workaround. Primary linkage unknown — review.'
                : null,
            },
            select: { id: true },
          })
          bookingItemId = item.id
        }
        report.bookingItemsCreated++
      } catch (e) {
        report.errors.push({ cart: cartId, error: `bookingItem.create: ${(e as Error).message.slice(0, 120)}` })
        continue
      }

      let asset: ReturnType<typeof assetByCategoryAndName.get> | null = null
      let aliasedTo: string | null = null
      if (!forceUnassigned && norm.normalized && !norm.isBackupHold) {
        const lookupName = NAME_ALIASES[norm.normalized] ?? norm.normalized
        if (lookupName !== norm.normalized) aliasedTo = lookupName
        asset = assetByCategoryAndName.get(`${category.id}|${lookupName}`) ?? null
      }

      if (!asset) {
        // Force-unassigned: add to its review bucket and skip the
        // unmatched-units bookkeeping (it's a deliberate choice).
        if (forceUnassigned && reviewBucket) {
          const note = routeOverride?.routeReason ?? inCategoryUnassigned?.reason
          report[reviewBucket].push({
            cartId,
            reservationId: String(r.reservation_id),
            planyoUnitName: rawUnit,
            targetCategory: category.name,
            startDate: startDateISO,
            endDate: endDateISO,
            note,
          })
        } else if (norm.isBackupHold) {
          // X - 2ND HOLD style entries → backup-hold review list
          // (handled by Part B's holdRank promotion; for now we just
          // surface them as "linkage needed").
          report.backupHoldsNeedLinkage.push({
            cartId,
            reservationId: String(r.reservation_id),
            planyoUnitName: rawUnit,
            targetCategory: category.name,
            startDate: startDateISO,
            endDate: endDateISO,
            note: 'Backup hold — primary linkage unknown (Planyo workaround did not record which booking this backs up).',
          })
        } else {
          // Genuinely unmatched — should be near zero post-reconciliation.
          const reportKey = !norm.normalized
            ? `${rawUnit}  [empty after normalization]`
            : `${rawUnit}  →  ${norm.normalized}`
          const slot = report.unmatchedUnits.get(reportKey) ?? { count: 0, resourceName, sampleCarts: [] }
          slot.count++
          if (slot.sampleCarts.length < 3 && !slot.sampleCarts.includes(cartId)) slot.sampleCarts.push(cartId)
          report.unmatchedUnits.set(reportKey, slot)
        }
        // BookingItem stays REQUESTED in all the above branches; journal still written below.
      } else {
        if (aliasedTo) {
          report.aliasedAssetLookups.push({
            cartId,
            reservationId: String(r.reservation_id),
            planyoUnitName: rawUnit,
            aliasedTo,
            categoryName: category.name,
          })
        }
        try {
          if (!dryRun) {
            await prisma.bookingAssignment.create({
              data: {
                bookingItemId,
                assetId: asset.id,
                // Per-reservation dates, NOT the cart envelope —
                // see the note above where resStart/resEnd are
                // derived from r.start_time/r.end_time.
                startDate: resStart,
                endDate: resEnd,
                status: 'ASSIGNED',
              },
            })
            // Flip BookingItem to ASSIGNED (qty=1, one assignment).
            await prisma.bookingItem.update({ where: { id: bookingItemId }, data: { status: 'ASSIGNED' } })
          }
          report.bookingAssignmentsCreated++
        } catch (e) {
          report.errors.push({ cart: cartId, error: `bookingAssignment.create: ${(e as Error).message.slice(0, 120)}` })
        }
      }

      // ── Reservation journal upsert ──
      if (!dryRun) {
        await prisma.reservation.upsert({
          where: { planyoReservationId: String(r.reservation_id) },
          create: {
            planyoReservationId: String(r.reservation_id), planyoCartId: String(cartId),
            bookingId, unitName: rawUnit || '(blank)', category: resourceName,
            startTime: new Date(Date.parse((r.start_time ?? '').replace(' ', 'T') + 'Z')),
            endTime: new Date(Date.parse((r.end_time ?? '').replace(' ', 'T') + 'Z')),
            status: 'CONFIRMED', source: 'PLANYO',
          },
          update: { bookingId },
        })
        report.reservationJournalRowsCreated++
      }
    }
  }

  // ── Print summary ──
  console.log('━━━ Summary ━━━')
  console.log(JSON.stringify({
    dryRun,
    cartsProcessed: report.cartsProcessed,
    cartsSkippedFullyImported: report.cartsSkippedFullyImported,
    cartsSkippedAllCancelled: report.cartsSkippedAllCancelled,
    cartsAppendedToExisting: report.cartsAppendedToExisting,
    bookingsBackfilledWithCartId: backfilledCartIds,
    bookingsCreated: report.bookingsCreated,
    bookingItemsCreated: report.bookingItemsCreated,
    bookingAssignmentsCreated: report.bookingAssignmentsCreated,
    reservationJournalRowsCreated: report.reservationJournalRowsCreated,
    companiesCreated: report.companiesCreated,
    personsCreated: report.personsCreated,
    skippedReservationsAlreadyImported: report.skippedReservationsAlreadyImported,
    skippedReservationsCancelled: report.skippedReservationsCancelled,
    unmatchedResources: report.unmatchedResources.size,
    unmatchedUnits: report.unmatchedUnits.size,
    sprinterUnassigned: report.sprinterUnassigned.length,
    lankershimRoomNeeded: report.lankershimRoomNeeded.length,
    backupHoldsNeedLinkage: report.backupHoldsNeedLinkage.length,
    aliasedAssetLookups: report.aliasedAssetLookups.length,
    errors: report.errors.length,
  }, null, 2))

  // ── Detailed unmatched lists (the brief: "Log unmatched units/resources to a report") ──
  const reportPath = '/tmp/scheduling-planyo-migration-report.json'
  writeFileSync(reportPath, JSON.stringify({
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    dryRun,
    flags: { FORWARD_DAYS, DEFAULT_AGENT_EMAIL },
    counts: {
      cartsProcessed: report.cartsProcessed,
      bookingsCreated: report.bookingsCreated,
      bookingItemsCreated: report.bookingItemsCreated,
      bookingAssignmentsCreated: report.bookingAssignmentsCreated,
      companiesCreated: report.companiesCreated,
      personsCreated: report.personsCreated,
      skippedReservationsAlreadyImported: report.skippedReservationsAlreadyImported,
      skippedReservationsCancelled: report.skippedReservationsCancelled,
      cartsSkippedFullyImported: report.cartsSkippedFullyImported,
      cartsSkippedAllCancelled: report.cartsSkippedAllCancelled,
    },
    unmatchedResources: [...report.unmatchedResources.entries()].map(([name, info]) => ({ resourceName: name, ...info })),
    unmatchedUnits: [...report.unmatchedUnits.entries()].map(([name, info]) => ({ unitName: name, ...info })),
    reviewLists: {
      sprinterUnassigned: report.sprinterUnassigned,
      lankershimRoomNeeded: report.lankershimRoomNeeded,
      backupHoldsNeedLinkage: report.backupHoldsNeedLinkage,
      aliasedAssetLookups: report.aliasedAssetLookups,
    },
    errors: report.errors,
  }, null, 2))
  console.log('')
  console.log(`Full report → ${reportPath}`)
  if (report.unmatchedResources.size > 0) {
    console.log(`\nUnmatched Planyo resources (no AssetCategory.planyoResourceId match):`)
    for (const [name, info] of report.unmatchedResources) console.log(`  ${info.count}× "${name}"  samples: ${info.sampleUnits.join(', ')}`)
  }
  if (report.unmatchedUnits.size > 0) {
    console.log(`\nUnmatched units (no Asset.unitName match within category):`)
    for (const [name, info] of report.unmatchedUnits) console.log(`  ${info.count}× "${name}"  (resource ${info.resourceName})  sample carts: ${info.sampleCarts.join(', ')}`)
  }
  if (report.sprinterUnassigned.length > 0) {
    console.log(`\nSprinter unassigned holds (${report.sprinterUnassigned.length}) — fleet to assign specific Cargo-w-Liftgate units:`)
    for (const it of report.sprinterUnassigned) console.log(`  cart ${it.cartId} · ${it.startDate}→${it.endDate} · "${it.planyoUnitName}" (category: ${it.targetCategory})`)
  }
  if (report.lankershimRoomNeeded.length > 0) {
    console.log(`\nLankershim Studios — room assignment needed (${report.lankershimRoomNeeded.length}):`)
    for (const it of report.lankershimRoomNeeded) console.log(`  cart ${it.cartId} · ${it.startDate}→${it.endDate} · "${it.planyoUnitName}" (category: ${it.targetCategory})`)
  }
  if (report.backupHoldsNeedLinkage.length > 0) {
    console.log(`\nBackup holds needing manual primary-linkage (${report.backupHoldsNeedLinkage.length}):`)
    for (const it of report.backupHoldsNeedLinkage) console.log(`  cart ${it.cartId} · ${it.startDate}→${it.endDate} · "${it.planyoUnitName}" (category: ${it.targetCategory})`)
  }
  if (report.aliasedAssetLookups.length > 0) {
    console.log(`\nAliased Asset lookups (${report.aliasedAssetLookups.length}) — confirm these mappings:`)
    for (const it of report.aliasedAssetLookups) console.log(`  "${it.planyoUnitName}"  →  Asset "${it.aliasedTo}"  (category ${it.categoryName})`)
  }
  if (report.errors.length > 0) {
    console.log(`\nErrors (${report.errors.length}):`)
    for (const e of report.errors.slice(0, 20)) console.log(`  cart ${e.cart}: ${e.error}`)
  }
}

main()
  .catch((e) => {
    console.error('[planyo-migration] fatal:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
