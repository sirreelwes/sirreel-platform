/**
 * Soft-hold the fleet a quote commits us to (Wes 2026-08-25).
 *
 * "When we send a quote out, a hold is implied — because if they accept
 * and we've rented that vehicle to someone else, we'd be in a bad place."
 * Before this, sending a quote reserved nothing: an approved order and
 * even a BOOKED one could exist with the unit showing free on the board.
 *
 * SOFT, not firm. Holds are created as backups (holdRank 2) so the unit
 * reads as spoken-for on the Reservations board without hard-blocking —
 * a quote that never converts must not freeze a truck. Approval promotes
 * them to rank 1 (see promoteHoldsOnApproval).
 *
 * Only UNIT-TRACKED lines are held. Quote lines carry an InventoryItem,
 * NOT an AssetCategory — an early version of this filtered on
 * `assetCategoryId` and would have silently held NOTHING, including the
 * one real Cargo Van it was written for. The signal that matters lives on
 * the catalog row: trackingMode=UNIT_TRACKED plus a legacyAssetCategoryId
 * to hold against. Supplies (ladders, folding tables, costume racks) are
 * QUANTITY-tracked and are correctly skipped — that's why the four "gaps"
 * found on 2026-08-25 were really one.
 *
 * Idempotent by (booking, category, window): re-sending a quote must not
 * stack duplicate holds.
 *
 * NON-FATAL by contract. The caller sends the email first; a hold failure
 * must never make a delivered quote look like it failed.
 */

import { prisma } from '@/lib/prisma'
import { LineItemDepartment } from '@prisma/client'
import { isSignedAgreementStatus } from '@/lib/portal/agreementStatus'

export interface HoldOnQuoteResult {
  created: number
  reused: number
  skippedNoDates: number
  skippedNotUnitTracked: number
  error: string | null
}

export async function holdOnQuoteSend(orderId: string): Promise<HoldOnQuoteResult> {
  const out: HoldOnQuoteResult = {
    created: 0, reused: 0, skippedNoDates: 0, skippedNotUnitTracked: 0, error: null,
  }
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, jobId: true, companyId: true, agentId: true, bookingId: true,
        job: { select: { name: true } },
        lineItems: {
          select: {
            quantity: true, pickupDate: true, returnDate: true, assetCategoryId: true,
            description: true,
            assetCategory: { select: { id: true, department: true } },
            inventoryItem: {
              select: { department: true, trackingMode: true, legacyAssetCategoryId: true },
            },
          },
        },
      },
    })
    if (!order) return { ...out, error: 'order not found' }

    /** The AssetCategory this line should hold against, or null. */
    const categoryFor = (li: (typeof order.lineItems)[number]): string | null => {
      // Legacy lines that carry the category directly.
      if (li.assetCategoryId) {
        const d = li.assetCategory?.department
        return d === LineItemDepartment.VEHICLES || d === LineItemDepartment.STAGES
          ? li.assetCategoryId
          : null
      }
      // Current lines: resolve through the catalog row.
      const inv = li.inventoryItem
      if (!inv || inv.trackingMode !== 'UNIT_TRACKED') return null
      if (inv.department !== LineItemDepartment.VEHICLES && inv.department !== LineItemDepartment.STAGES) return null
      return inv.legacyAssetCategoryId ?? null
    }

    const holdable = order.lineItems
      .map((li) => ({ li, categoryId: categoryFor(li) }))
      .filter(({ li, categoryId }) => {
        if (!categoryId) { out.skippedNotUnitTracked++; return false }
        if (!li.pickupDate || !li.returnDate) { out.skippedNoDates++; return false }
        return true
      })
    if (holdable.length === 0) return out

    // One Booking per order, reused across re-sends.
    let bookingId = order.bookingId
    if (!bookingId) {
      const existing = order.jobId
        ? await prisma.booking.findFirst({
            where: { jobId: order.jobId, source: 'AGENT_DIRECT' },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          })
        : null
      if (existing) bookingId = existing.id
    }
    // A booking releaseHoldsOnLost() cancelled comes back to life when
    // the quote does (mark-lost undo, or a re-send): flip it to REQUEST
    // before appending fresh items, or the new hold would hang off a
    // CANCELLED booking every board filters out.
    if (bookingId) {
      const existingBooking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { status: true },
      })
      if (existingBooking?.status === 'CANCELLED') {
        await prisma.booking.update({ where: { id: bookingId }, data: { status: 'REQUEST' } })
      }
    }
    if (!bookingId) {
      // A Booking needs a contact. Try the JOB's contacts first — the
      // person the quote actually went to lives there — then fall back
      // to anyone affiliated with the company. The original version
      // checked ONLY company affiliations, and a company with zero
      // Affiliation rows (Wild Goats Creative, 2026-08-29) silently
      // dropped the entire hold: S260828-003's SuperCube read as free
      // on the board while a live quote committed it.
      const jobContact = order.jobId
        ? await prisma.jobContact.findFirst({
            where: { jobId: order.jobId },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            select: { personId: true },
          })
        : null
      const person =
        jobContact ??
        (await prisma.person.findFirst({
          where: { affiliations: { some: { companyId: order.companyId, isCurrent: true } } },
          select: { id: true },
        }).then((p) => (p ? { personId: p.id } : null)))
      if (!person) return { ...out, error: 'no contact on the job or company to attach a booking to' }
      const created = await prisma.booking.create({
        data: {
          bookingNumber: `SR-Q-${Date.now()}`,
          companyId: order.companyId,
          personId: person.personId,
          agentId: order.agentId,
          jobId: order.jobId,
          jobName: order.job?.name ?? 'Quote hold',
          startDate: holdable[0].li.pickupDate!,
          endDate: holdable[0].li.returnDate!,
          source: 'AGENT_DIRECT',
          status: 'REQUEST',
        },
        select: { id: true },
      })
      bookingId = created.id
      await prisma.order.update({ where: { id: order.id }, data: { bookingId } })
    }

    for (const { li, categoryId } of holdable) {
      const dupe = await prisma.bookingItem.findFirst({
        where: {
          bookingId,
          categoryId: categoryId!,
          status: { in: ['REQUESTED', 'ASSIGNED'] },
        },
        select: { id: true },
      })
      if (dupe) { out.reused++; continue }
      await prisma.bookingItem.create({
        data: {
          bookingId,
          categoryId: categoryId!,
          quantity: li.quantity || 1,
          dailyRate: 0,
          status: 'REQUESTED',
          // Backup rank: visible as spoken-for, doesn't hard-block.
          holdRank: 2,
        },
      })
      out.created++
    }
    return out
  } catch (e) {
    return { ...out, error: e instanceof Error ? e.message : 'hold failed' }
  }
}

/**
 * Is the CLIENT's paperwork in? (Wes 2026-09-01: a hold "only becomes
 * booked when client approves quote and has paperwork submitted".)
 *
 * Deliberately the three things the CLIENT owes us — COI, signed rental
 * agreement, card on file. Driver-named and gear-assigned are OUR work
 * and appear in job readiness; holding a truck hostage to our own
 * dispatch admin would be backwards.
 */
export async function clientPaperworkIn(orderId: string): Promise<{
  ok: boolean
  missing: string[]
}> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      jobId: true,
      signedAgreements: { select: { contractType: true, status: true, coveredByAgreementId: true } },
      job: {
        select: {
          coiChecks: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { humanDecision: true, coverageVerified: true, policyExpiryDate: true },
          },
          bookings: {
            where: { status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
            select: { paperworkRequests: { select: { ccCardNumberEncrypted: true } } },
          },
        },
      },
    },
  })
  if (!order) return { ok: false, missing: ['order not found'] }

  const coi = order.job?.coiChecks[0] ?? null
  const coiExpired = coi?.policyExpiryDate ? coi.policyExpiryDate.getTime() < Date.now() : false
  const coiOk = !!coi && !coiExpired && coi.humanDecision === 'APPROVED' && coi.coverageVerified

  const rental = order.signedAgreements.filter((a) => a.contractType === 'RENTAL_AGREEMENT')
  const signOk =
    rental.length > 0 &&
    rental.every((a) => isSignedAgreementStatus(a.status) || !!a.coveredByAgreementId)

  const cardOk = (order.job?.bookings ?? []).some((b) =>
    b.paperworkRequests.some((p) => !!p.ccCardNumberEncrypted),
  )

  const missing: string[] = []
  if (!coiOk) missing.push('COI')
  if (!signOk) missing.push('signed agreement')
  if (!cardOk) missing.push('card on file')
  return { ok: missing.length === 0, missing }
}

/**
 * Decide whether this order's holds should be FIRM (rank 1) or stay a
 * soft backup (rank 2), and move them either way.
 *
 * Firm requires BOTH: the client approved the quote, AND their
 * paperwork is in (Wes 2026-09-01). Approval alone used to promote,
 * which meant a truck was hard-blocked for a client who had signed
 * nothing and given us no card.
 *
 * Idempotent and safe to call from any event that could change either
 * input — quote approval, COI sign-off, agreement signature, card
 * capture. Non-fatal: the triggering act must land even if this does
 * not.
 */
export async function reconcileHoldFirmness(orderId: string): Promise<{
  promoted: number
  demoted: number
  firm: boolean
  missing: string[]
  error: string | null
}> {
  const out = { promoted: 0, demoted: 0, firm: false, missing: [] as string[], error: null as string | null }
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { bookingId: true, jobId: true, quoteStatus: true, status: true },
    })
    if (!order) return { ...out, error: 'order not found' }

    // "Client approved the quote" — WON covers the portal approval and
    // the agent marking it approved; anything at/after BOOKED is past
    // the question.
    const approved =
      order.quoteStatus === 'WON' ||
      ['APPROVED', 'BOOKED', 'LOADED_READY', 'ON_JOB', 'RETURNED', 'LD_CHECK', 'INVOICED', 'CLOSED'].includes(
        order.status,
      )

    const paperwork = await clientPaperworkIn(orderId)
    const firm = approved && paperwork.ok
    out.firm = firm
    out.missing = approved ? paperwork.missing : ['client approval', ...paperwork.missing]

    const bookingIds: string[] = []
    if (order.bookingId) bookingIds.push(order.bookingId)
    else if (order.jobId) {
      const rows = await prisma.booking.findMany({
        where: { jobId: order.jobId, source: 'AGENT_DIRECT' },
        select: { id: true },
      })
      bookingIds.push(...rows.map((r) => r.id))
    }
    if (bookingIds.length === 0) return out

    if (firm) {
      const res = await prisma.bookingItem.updateMany({
        where: { bookingId: { in: bookingIds }, holdRank: 2, status: 'REQUESTED' },
        data: { holdRank: 1 },
      })
      out.promoted = res.count
    } else {
      // Something lapsed (a COI expired, an agreement was re-issued):
      // the hold drops back to a backup rather than silently keeping a
      // firm block it no longer earns.
      const res = await prisma.bookingItem.updateMany({
        where: { bookingId: { in: bookingIds }, holdRank: 1, status: 'REQUESTED' },
        data: { holdRank: 2 },
      })
      out.demoted = res.count
    }
    return out
  } catch (e) {
    return { ...out, error: e instanceof Error ? e.message : 'reconcile failed' }
  }
}

/**
 * @deprecated Use reconcileHoldFirmness — approval alone is no longer
 * enough to make a hold firm (Wes 2026-09-01). Kept as a thin shim so
 * existing call sites keep compiling while they migrate.
 */
export async function promoteHoldsOnApproval(orderId: string): Promise<{ promoted: number; error: string | null }> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { bookingId: true, jobId: true },
    })
    if (!order) return { promoted: 0, error: 'order not found' }

    const bookingIds: string[] = []
    if (order.bookingId) bookingIds.push(order.bookingId)
    else if (order.jobId) {
      const rows = await prisma.booking.findMany({
        where: { jobId: order.jobId, source: 'AGENT_DIRECT' },
        select: { id: true },
      })
      bookingIds.push(...rows.map((r) => r.id))
    }
    if (bookingIds.length === 0) return { promoted: 0, error: null }

    const res = await prisma.bookingItem.updateMany({
      where: { bookingId: { in: bookingIds }, holdRank: 2, status: 'REQUESTED' },
      data: { holdRank: 1 },
    })
    return { promoted: res.count, error: null }
  } catch (e) {
    return { promoted: 0, error: e instanceof Error ? e.message : 'promote failed' }
  }
}

/**
 * Release a quote's soft holds when the quote is marked LOST
 * (Wes 2026-08-31: a dead quote must not keep a unit spoken-for).
 *
 * Releases ONLY rank-2 REQUESTED items — the unpromoted quote-send
 * holds. Rank-1 or ASSIGNED items were promoted/assigned by a human
 * (or belong to a WON sibling order sharing the job booking) and are
 * never silently released here. Uses the canonical release recipe
 * (item → UNFULFILLED, active assignments → SWAPPED — see
 * /api/scheduling/booking-items/[id]/release). A booking left with no
 * live items is CANCELLED iff it is still in REQUEST, so the board and
 * the action-items worklist stop reading it as a live reservation;
 * holdOnQuoteSend() resurrects it if the quote reopens.
 *
 * NON-FATAL by the same contract as the rest of this module.
 */
export async function releaseHoldsOnLost(orderId: string): Promise<{
  released: number
  bookingsCancelled: number
  error: string | null
}> {
  const out = { released: 0, bookingsCancelled: 0, error: null as string | null }
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { bookingId: true, jobId: true },
    })
    if (!order) return { ...out, error: 'order not found' }

    const bookingIds: string[] = []
    if (order.bookingId) bookingIds.push(order.bookingId)
    else if (order.jobId) {
      const rows = await prisma.booking.findMany({
        where: { jobId: order.jobId, source: 'AGENT_DIRECT', status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
        select: { id: true },
      })
      bookingIds.push(...rows.map((r) => r.id))
    }
    if (bookingIds.length === 0) return out

    for (const bookingId of bookingIds) {
      const items = await prisma.bookingItem.findMany({
        where: { bookingId, holdRank: 2, status: 'REQUESTED' },
        select: { id: true },
      })
      for (const item of items) {
        await prisma.$transaction([
          prisma.bookingAssignment.updateMany({
            where: { bookingItemId: item.id, status: 'ASSIGNED' },
            data: { status: 'SWAPPED' },
          }),
          prisma.bookingItem.update({
            where: { id: item.id },
            data: { status: 'UNFULFILLED' },
          }),
        ])
        out.released++
      }
      // Cancel the booking only when it is still a bare request with
      // nothing live left on it.
      const liveLeft = await prisma.bookingItem.count({
        where: { bookingId, status: { in: ['REQUESTED', 'ASSIGNED'] } },
      })
      if (liveLeft === 0) {
        const res = await prisma.booking.updateMany({
          where: { id: bookingId, status: 'REQUEST' },
          data: { status: 'CANCELLED' },
        })
        out.bookingsCancelled += res.count
      }
    }
    return out
  } catch (e) {
    return { ...out, error: e instanceof Error ? e.message : 'release failed' }
  }
}
