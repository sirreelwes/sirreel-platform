/**
 * Planyo → Neon Reservation sync (Path A, one-way).
 *
 * Calls Planyo `list_reservations` with `detail_level=3` (the only
 * reliable detail method per the brief — get_reservation_details and
 * get_reservation_info both return "Invalid method" on our site
 * configuration) over a configurable window and upserts each row
 * into the `reservations` table keyed by `planyoReservationId`.
 *
 * Linking key resolution (decides `bookingId` on each row):
 *   1. Parse `SR-YYYY-XXXX` booking number from Planyo notes
 *      (admin_notes preferred, falls back to user_notes). The team
 *      adopts writing this into Planyo as the auto-link convention.
 *   2. Inherit from the existing Reservation row if one already
 *      exists for this `planyoReservationId` (preserves manual
 *      Dispatch-linker assignments across re-syncs).
 *   3. Else orphan (`bookingId` left null) — surfaces in Dispatch.
 *
 * Cancellation: reservations that move to a cancelled Planyo status
 * (mapped below) get `status: CANCELLED` on the next sync — soft
 * mark, row stays so the timeline can still resolve historical
 * references and audit trail survives. The cron does not delete.
 *
 * Idempotency: safe to re-run. Upsert on `planyoReservationId`
 * (which is `@unique`). All side effects flow through a single
 * write per row.
 *
 * Site ID is fixed to 36171 per brief; window is env-configurable
 * via PLANYO_SYNC_DAYS_BACK and PLANYO_SYNC_DAYS_AHEAD (defaults
 * 7 and 90).
 */

import { prisma } from '@/lib/prisma'
import type { ReservationStatus } from '@prisma/client'

const PLANYO_BASE = 'https://www.planyo.com/rest/'
const SITE_ID = process.env.PLANYO_SITE_ID || '36171'

export interface SyncResult {
  windowStart: string
  windowEnd: string
  planyoRowsFetched: number
  reservationsUpserted: number
  resolvedToBooking: number
  orphaned: number
  cancelled: number
  errors: string[]
}

// Planyo status code map — see /api/timeline/route.ts:21 for the
// existing handling; same source-of-truth applied here. 11/4 = booked,
// 8 = hold, 1 = inquiry treated as hold for our purposes, 2 = cancelled.
function mapPlanyoStatus(raw: unknown): ReservationStatus {
  const n = parseInt(String(raw), 10)
  if (n === 2) return 'CANCELLED'
  if (n === 11 || n === 4) return 'CONFIRMED'
  return 'HOLD'
}

const SR_BOOKING_RE = /\b(SR-\d{4}-\d{4})\b/

/** Extract SR-YYYY-XXXX from Planyo notes — admin_notes wins. */
function parseBookingNumber(adminNotes: string | null, userNotes: string | null): string | null {
  const a = adminNotes && adminNotes.match(SR_BOOKING_RE)
  if (a) return a[1]
  const u = userNotes && userNotes.match(SR_BOOKING_RE)
  if (u) return u[1]
  return null
}

interface PlanyoReservation {
  reservation_id: string | number
  cart_id?: string | number | null
  unit_assignment?: string | null
  name?: string | null // resource / category name
  start_time?: string | null
  end_time?: string | null
  status?: string | number | null
  admin_notes?: string | null
  user_notes?: string | null
  // Customer-side identifiers on the reservation root. These come
  // straight from list_reservations(detail_level=3) and are the only
  // recoverable contact data for Bookings backfilled from Planyo
  // orphans.
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  // Planyo custom rental properties — populated when the team
  // entered them on the reservation. Used by the Dispatch
  // auto-match heuristic.
  properties?: {
    Company_Name?: string | null
    Job_Name?: string | null
    SirReel_Agent?: string | null
  } | null
}

async function planyoListReservations(start: string, end: string): Promise<PlanyoReservation[]> {
  const apiKey = process.env.PLANYO_API_KEY
  if (!apiKey) throw new Error('PLANYO_API_KEY is not set')

  const url = new URL(PLANYO_BASE)
  url.searchParams.set('method', 'list_reservations')
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('site_id', SITE_ID)
  url.searchParams.set('format', 'json')
  url.searchParams.set('start_time', start)
  url.searchParams.set('end_time', end)
  url.searchParams.set('detail_level', '3')
  url.searchParams.set('results_per_page', '500')

  const res = await fetch(url.toString())
  const data = (await res.json()) as { response_code?: number; response_message?: string; data?: { results?: PlanyoReservation[] } }
  if (data.response_code !== 0) {
    throw new Error(`Planyo list_reservations failed: ${data.response_message || 'unknown'}`)
  }
  return data.data?.results || []
}

function isoMidnight(d: Date): string {
  // Planyo expects "YYYY-MM-DD HH:MM:SS" local-ish; midnight is safe.
  return d.toISOString().slice(0, 10) + ' 00:00:00'
}

/**
 * Run one sync pass. Returns counts so the caller (cron route or
 * manual trigger) can report.
 */
export async function syncPlanyoToReservations(): Promise<SyncResult> {
  const daysBack = parseInt(process.env.PLANYO_SYNC_DAYS_BACK || '7', 10)
  const daysAhead = parseInt(process.env.PLANYO_SYNC_DAYS_AHEAD || '90', 10)
  const now = new Date()
  const start = new Date(now); start.setDate(start.getDate() - daysBack)
  const end = new Date(now); end.setDate(end.getDate() + daysAhead)
  const windowStart = isoMidnight(start)
  const windowEnd = isoMidnight(end)

  const errors: string[] = []
  const planyoRows = await planyoListReservations(windowStart, windowEnd)

  // Pre-resolve all SR booking numbers we see → ids, in one query.
  const bookingNumbers = new Set<string>()
  for (const r of planyoRows) {
    const num = parseBookingNumber(r.admin_notes ?? null, r.user_notes ?? null)
    if (num) bookingNumbers.add(num)
  }
  const bookingsByNumber = new Map<string, string>()
  if (bookingNumbers.size > 0) {
    const found = await prisma.booking.findMany({
      where: { bookingNumber: { in: [...bookingNumbers] } },
      select: { id: true, bookingNumber: true },
    })
    for (const b of found) bookingsByNumber.set(b.bookingNumber, b.id)
  }

  // Pre-fetch existing reservation rows so inherited bookingId paths
  // can be served without a per-row query. Map by planyoReservationId.
  const planyoIds = planyoRows.map((r) => String(r.reservation_id)).filter(Boolean)
  const existingRows = await prisma.reservation.findMany({
    where: { planyoReservationId: { in: planyoIds } },
    select: { planyoReservationId: true, bookingId: true },
  })
  const existingBookingByPlanyoId = new Map<string, string | null>()
  for (const row of existingRows) {
    if (row.planyoReservationId) existingBookingByPlanyoId.set(row.planyoReservationId, row.bookingId)
  }

  let reservationsUpserted = 0
  let resolvedToBooking = 0
  let orphaned = 0
  let cancelled = 0

  for (const r of planyoRows) {
    const planyoId = String(r.reservation_id || '').trim()
    if (!planyoId) continue

    const startTime = r.start_time ? new Date(r.start_time) : null
    const endTime = r.end_time ? new Date(r.end_time) : null
    if (!startTime || !endTime || isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      errors.push(`reservation_id=${planyoId}: unparseable start/end_time`)
      continue
    }

    // Linking key resolution
    const parsedNumber = parseBookingNumber(r.admin_notes ?? null, r.user_notes ?? null)
    let bookingId: string | null = null
    if (parsedNumber && bookingsByNumber.has(parsedNumber)) {
      bookingId = bookingsByNumber.get(parsedNumber)!
    } else {
      // Inherit from existing row if present (preserves Dispatch-link
      // assignments across re-syncs).
      const inherited = existingBookingByPlanyoId.get(planyoId)
      if (inherited) bookingId = inherited
    }

    const status = mapPlanyoStatus(r.status)
    const unitName = (r.unit_assignment || r.name || 'Unknown').trim() || 'Unknown'
    const cartId = r.cart_id ? String(r.cart_id) : null

    const planyoCompany = r.properties?.Company_Name?.trim() || null
    const planyoJobName = r.properties?.Job_Name?.trim() || null
    const planyoAgent = r.properties?.SirReel_Agent?.trim() || null

    // Customer fields. Planyo's empty-string convention for missing
    // values would otherwise become non-null '' strings, which the
    // backfill find-or-create logic would treat as legitimate values.
    // Normalise to null on empty.
    const first = (r.first_name || '').trim()
    const last = (r.last_name || '').trim()
    const customerName = [first, last].filter(Boolean).join(' ') || null
    const customerEmail = (r.email || '').trim() || null
    const customerPhone = (r.phone || '').trim() || null

    try {
      await prisma.reservation.upsert({
        where: { planyoReservationId: planyoId },
        create: {
          planyoReservationId: planyoId,
          planyoCartId: cartId,
          unitName,
          category: r.name || null,
          startTime,
          endTime,
          status,
          source: 'PLANYO',
          bookingId,
          planyoCompany,
          planyoJobName,
          planyoAgent,
          planyoCustomerName: customerName,
          planyoCustomerEmail: customerEmail,
          planyoCustomerPhone: customerPhone,
          notes: r.admin_notes || r.user_notes || null,
        },
        update: {
          planyoCartId: cartId,
          unitName,
          category: r.name || null,
          startTime,
          endTime,
          status,
          bookingId,
          planyoCompany,
          planyoJobName,
          planyoAgent,
          planyoCustomerName: customerName,
          planyoCustomerEmail: customerEmail,
          planyoCustomerPhone: customerPhone,
          notes: r.admin_notes || r.user_notes || null,
        },
      })
      reservationsUpserted += 1
      if (bookingId) resolvedToBooking += 1
      else orphaned += 1
      if (status === 'CANCELLED') cancelled += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`reservation_id=${planyoId}: upsert failed — ${msg}`)
    }
  }

  return {
    windowStart,
    windowEnd,
    planyoRowsFetched: planyoRows.length,
    reservationsUpserted,
    resolvedToBooking,
    orphaned,
    cancelled,
    errors,
  }
}
