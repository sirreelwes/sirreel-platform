/**
 * Is the PARTNER papered before their gear goes on a client's job?
 *
 * Wes, 2026-09-18, reading Graduation Day's counsel's redline of §32
 * Third-Party Equipment: "go ahead with the unsigned-partner gate."
 *
 * ── Why this exists ───────────────────────────────────────────────────
 * §32 of the rental agreement supplies a partner's unit to the client "on
 * the same terms as Equipment we own", and Graduation Day's counsel pushed
 * it further on 2026-09-17: SirReel stays liable for a failure — theirs or
 * ours — to meet Section 4, and for "the acts and omissions of such third
 * parties". Every one of those obligations is survivable because the
 * PARTNER carries it back to back:
 *
 *   · Partner agreement §6 — condition, maintenance, load-testing,
 *     certifications, and repair-or-replace at their cost on a failure;
 *   · Partner agreement §11 — they indemnify "SirReel, its officers,
 *     employees, agents AND CLIENTS" for the condition of a Unit, their
 *     breach, and the acts or omissions of personnel they supply,
 *     including in delivery, setup and collection. That indemnity is
 *     expressly carved OUT of their own consequential-damages exclusion.
 *
 * All of which requires a SIGNED agreement. Without one there is nothing
 * behind the promise we just made the client, and the exposure stops with
 * us.
 *
 * ── The hole this closes ──────────────────────────────────────────────
 * The signature gate already existed — `PARTNER_APPROVED_VENDOR_WHERE` in
 * site/vehicleCatalog.ts — and it guards the PUBLIC LISTING only. The
 * quote path never consulted it: `/api/catalog/search` matches a partner
 * unit on `isActive` + `offeredToSirReel` + `vendor.isActive`, so a rep
 * could quote and book an unsigned partner's unit onto a job. VSM Planet
 * is the live example: their roster is quotable today and their agreement
 * is not signed.
 *
 * ── What counts as a partner unit HERE ────────────────────────────────
 * A live SubRental carrying a ROSTER unit (`subcontractedVehicleId`), and
 * that is the only test. Deliberately NOT `PARTNER_SUB_RENTAL_WHERE` from
 * orders/partnerLines.ts, which excludes DELIVER_TO_SIRREEL: that
 * predicate answers "does this gear come through our warehouse", which is
 * a question about the pick list. This one answers "whose gear is it" —
 * and a partner's generator dropped at Sun Valley is still a partner's
 * generator under §32.
 *
 * AD-HOC sub-leases (a SubRental with no roster unit — "Sub-rent…" from
 * another house) are deliberately out of scope. §32 covers them too, but
 * the backstop there is that house's OWN rental terms, under which we are
 * the renter. There is paper; it just isn't ours. A gate that fired on
 * every sub-rent would be noise.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'

type Db = PrismaClient | Prisma.TransactionClient

/** Why a partner's paper does not cover this booking. */
export type PartnerPaperStatus = 'signed' | 'none' | 'unsigned' | 'expired' | 'not-yet-effective'

export interface PartnerAgreementFacts {
  signedAt: Date | null
  effectiveDate: Date | null
  expiryDate: Date | null
}

export interface UnpaperedPartner {
  vendorId: string
  vendorName: string
  /** Which units on THIS order ride on that partner's paper. */
  unitNames: string[]
  status: PartnerPaperStatus
  /** Set when they signed something — the date, even if it has lapsed. */
  signedAt: Date | null
  expiryDate: Date | null
}

export interface PartnerPaperGateResult {
  /** False when at least one partner on the order has NOTHING signed. */
  ok: boolean
  /** Nothing signed at all — the blocking case. */
  unsigned: UnpaperedPartner[]
  /** Signed, but the agreement has lapsed or has not started. Never blocks. */
  lapsed: UnpaperedPartner[]
  /** One line for the operator, or null when the order is clean. */
  message: string | null
}

/**
 * The verdict on one partner's agreements, from the rows alone.
 *
 * The BEST row wins: a partner with a lapsed 2025 agreement and a current
 * signed one is covered. Dates are inclusive of their calendar day, the
 * same reading `isCoverageCurrent` takes for a company's annual master.
 */
export function partnerPaperStatus(
  agreements: PartnerAgreementFacts[],
  now: Date = new Date(),
): PartnerPaperStatus {
  if (agreements.length === 0) return 'none'
  const signed = agreements.filter((a) => a.signedAt)
  if (signed.length === 0) return 'unsigned'

  let sawFuture = false
  for (const a of signed) {
    if (a.effectiveDate && a.effectiveDate.getTime() > now.getTime()) {
      sawFuture = true
      continue
    }
    if (a.expiryDate) {
      const endOfDay = new Date(a.expiryDate)
      endOfDay.setUTCHours(23, 59, 59, 999)
      if (endOfDay.getTime() < now.getTime()) continue
    }
    return 'signed'
  }
  return sawFuture ? 'not-yet-effective' : 'expired'
}

/** Whether a status leaves the client's promise unbacked. */
export function blocksBooking(status: PartnerPaperStatus): boolean {
  return status === 'none' || status === 'unsigned'
}

const PHRASE: Record<PartnerPaperStatus, string> = {
  signed: 'signed',
  none: 'has no partner agreement on file',
  unsigned: 'has never signed their partner agreement',
  expired: 'signed a partner agreement that has expired',
  'not-yet-effective': 'signed a partner agreement that has not started yet',
}

/** The operator's sentence. Names the partner and their units — "a partner
 *  is unsigned" is not something anyone can act on. */
export function partnerPaperMessage(
  unsigned: UnpaperedPartner[],
  lapsed: UnpaperedPartner[] = [],
): string | null {
  const parts: string[] = []
  for (const p of [...unsigned, ...lapsed]) {
    const units = p.unitNames.length ? ` (${p.unitNames.join(', ')})` : ''
    parts.push(`${p.vendorName}${units} ${PHRASE[p.status]}`)
  }
  if (parts.length === 0) return null
  return (
    `${parts.join('; ')}. ` +
    `The rental agreement supplies their gear to the client on our terms and — on a negotiated ` +
    `agreement — leaves us answering for their testing and their crew. Their own agreement §6 and §11 ` +
    `are what carry that back to them, and without a signature there is nothing behind it. ` +
    `File the standard partner agreement on /crm/portals#partners first.`
  )
}

/**
 * Partners on this order whose paper does not cover it.
 *
 * Read-only. `ok: false` means at least one partner has nothing signed —
 * the caller decides whether that warns or stops (send-quote warns;
 * mark-booked stops and takes a confirmation).
 */
export async function partnerPaperGate(
  orderId: string,
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<PartnerPaperGateResult> {
  const rows = await db.subRental.findMany({
    where: {
      orderId,
      subcontractedVehicleId: { not: null },
      status: { not: 'CANCELLED' },
    },
    select: {
      vendorId: true,
      subcontractedVehicle: { select: { name: true } },
      vendor: {
        select: {
          id: true,
          name: true,
          agreements: {
            where: { deletedAt: null },
            select: { signedAt: true, effectiveDate: true, expiryDate: true },
          },
        },
      },
    },
  })
  if (rows.length === 0) return { ok: true, unsigned: [], lapsed: [], message: null }

  // One entry per PARTNER, carrying every unit of theirs on the order —
  // naming the same vendor three times because they supplied three units
  // is noise, and the fix is one signature either way.
  const byVendor = new Map<string, UnpaperedPartner>()
  for (const r of rows) {
    if (!r.vendor) continue
    const status = partnerPaperStatus(r.vendor.agreements, now)
    if (status === 'signed') continue
    const unit = r.subcontractedVehicle?.name?.trim()
    const existing = byVendor.get(r.vendor.id)
    if (existing) {
      if (unit && !existing.unitNames.includes(unit)) existing.unitNames.push(unit)
      continue
    }
    const signed = r.vendor.agreements.filter((a) => a.signedAt)
    byVendor.set(r.vendor.id, {
      vendorId: r.vendor.id,
      vendorName: r.vendor.name,
      unitNames: unit ? [unit] : [],
      status,
      signedAt: signed.length
        ? signed.reduce<Date | null>((newest, a) => (!newest || (a.signedAt && a.signedAt > newest) ? a.signedAt : newest), null)
        : null,
      expiryDate: signed.find((a) => a.expiryDate)?.expiryDate ?? null,
    })
  }

  const all = [...byVendor.values()]
  const unsigned = all.filter((p) => blocksBooking(p.status))
  const lapsed = all.filter((p) => !blocksBooking(p.status))
  return {
    ok: unsigned.length === 0,
    unsigned,
    lapsed,
    message: partnerPaperMessage(unsigned, lapsed),
  }
}
