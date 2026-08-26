/**
 * Cart adoption — when the rental is already in HQ, link it instead of
 * importing a second copy.
 *
 * THE BUG THIS FIXES. The importer's idempotency anchor is
 * `Booking.planyoCartId`, which a natively-entered booking does not have.
 * So a rental the team put into HQ and ALSO has in Planyo is invisible to
 * the importer, and the next run mints a second Booking for the same real
 * rental — two vehicles held, on the same job, for the same dates. Three
 * jobs were in that state on 2026-08-26, two of them from a single
 * overnight run.
 *
 * WHAT ADOPTION DOES. Stamp the cart id onto the NATIVE booking and write
 * the cart's Reservation journal rows against it. After that the cart is
 * "already in HQ" by the importer's own test, so it never imports again,
 * and the journal is complete for anything that reads it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not change `source`. Native is
 * the system of record through the cutover (Wes 2026-08-26), and every
 * sync write is gated by scopeGuard on `source === 'PLANYO_BACKFILL'`.
 * Leaving the native source intact means the sync can never overwrite a
 * booking a human owns — adoption LINKS the two, it does not subordinate
 * HQ's copy to Planyo's. The cost is that later Planyo-side edits to an
 * adopted cart stop flowing in; that is the intended trade, and
 * reconcileHolds reports those as skipped-adopted rather than failing.
 *
 * MATCHING IS STRICT ON PURPOSE. Same company, identical start AND end
 * dates, and an identical set of categories. A production can genuinely
 * take two identical vans on the same dates, and a wrong adoption silently
 * merges two real reservations into one — much worse than the duplicate it
 * was trying to avoid. Anything less than an exact match imports as before
 * and surfaces on the job page for a human.
 */

import type { PrismaClient } from '@prisma/client'
import { laDateToDbDate, laDateStartToUTC, laDateEndToUTC } from './dateConvention'
import type { CartImportPlan } from './importNewCart'

/** Booking states that still hold equipment. */
const LIVE_STATUSES = ['REQUEST', 'AI_REVIEW', 'PENDING_APPROVAL', 'CONFIRMED', 'ACTIVE'] as const

export interface AdoptionCandidate {
  bookingId: string
  bookingNumber: string
  reason: string
}

/**
 * The native booking this cart is already represented by, or null.
 *
 * Runs AFTER planCartImport (which resolves the company and the category
 * set) and BEFORE applyCartImport, so it compares like with like: the same
 * company id and the same categories the import would otherwise create.
 */
export async function findAdoptableNativeBooking(
  prisma: PrismaClient,
  plan: CartImportPlan,
): Promise<AdoptionCandidate | null> {
  // Only an EXISTING company can match. A cart whose company would be
  // created cannot have a native twin by definition.
  const resolved = plan.resolvedCompany
  const companyId =
    resolved && typeof resolved === 'object' && 'id' in resolved ? (resolved.id as string) : null
  if (!companyId) return null

  const wantCategories = [...new Set(plan.bookingItemDrafts.map((d) => d.categoryId))].sort()
  if (wantCategories.length === 0) return null

  const start = laDateToDbDate(plan.bookingDraft.startLA)
  const end = laDateToDbDate(plan.bookingDraft.endLA)

  const natives = await prisma.booking.findMany({
    where: {
      companyId,
      planyoCartId: null, // native by definition
      status: { in: [...LIVE_STATUSES] },
      startDate: start,
      endDate: end,
    },
    select: {
      id: true,
      bookingNumber: true,
      items: { select: { categoryId: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  for (const n of natives) {
    const has = [...new Set(n.items.map((i) => i.categoryId))].sort()
    if (has.length === 0) continue
    if (has.length !== wantCategories.length) continue
    if (!has.every((c, i) => c === wantCategories[i])) continue
    return {
      bookingId: n.id,
      bookingNumber: n.bookingNumber,
      reason: `same company, ${plan.bookingDraft.startLA}→${plan.bookingDraft.endLA}, ${has.length} matching categor${has.length === 1 ? 'y' : 'ies'}`,
    }
  }
  return null
}

/**
 * Link the cart to the native booking and mirror its reservations onto it.
 *
 * Idempotent: the cart stamp is skipped when already set, and each
 * Reservation upserts on its `planyoReservationId` (unique), so a re-run
 * adds nothing. No BookingItem or BookingAssignment is created — the
 * native booking's own equipment stands, which is the whole point.
 */
export async function adoptCartIntoNativeBooking(
  prisma: PrismaClient,
  bookingId: string,
  plan: CartImportPlan,
): Promise<{ reservationsLinked: number }> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.booking.findUnique({
      where: { id: bookingId },
      select: { planyoCartId: true, source: true },
    })
    if (!current) throw new Error(`adoptCart: booking ${bookingId} vanished`)
    if (current.planyoCartId && current.planyoCartId !== plan.cart) {
      // Someone else's cart already owns this booking — never steal it.
      throw new Error(
        `adoptCart: booking ${bookingId} already carries cart ${current.planyoCartId}, refusing to relink to ${plan.cart}`,
      )
    }
    if (!current.planyoCartId) {
      await tx.booking.update({
        where: { id: bookingId },
        // source is intentionally untouched — see the header.
        data: { planyoCartId: plan.cart },
      })
    }

    let linked = 0
    for (const r of plan.reservationDrafts) {
      await tx.reservation.upsert({
        where: { planyoReservationId: r.planyoReservationId },
        create: {
          bookingId,
          unitName: r.unitName,
          category: r.category,
          startTime: laDateStartToUTC(r.startLA),
          endTime: laDateEndToUTC(r.endLA),
          status: 'HOLD',
          source: 'PLANYO',
          planyoReservationId: r.planyoReservationId,
          planyoCartId: r.planyoCartId,
          planyoCompany: r.planyoCompany,
          planyoJobName: r.planyoJobName,
          planyoAgent: r.planyoAgent,
          planyoCustomerName: r.planyoCustomerName,
          planyoCustomerEmail: r.planyoCustomerEmail,
          planyoCustomerPhone: r.planyoCustomerPhone,
          notes: r.notes,
        },
        // Point an existing journal row at the adopted booking; never
        // rewrite the Planyo facts recorded when it first arrived.
        update: { bookingId },
      })
      linked++
    }
    return { reservationsLinked: linked }
  })
}
