/**
 * What is there to bill L&D for on this order?
 *
 * Ana, 2026-09-14: *"a way to bill L&D on a separate invoice. That would be a
 * game changer for me."*
 *
 * HQ could already raise a separate L&D invoice — `generateLdInvoice`, type
 * LD, its own number sequence — but only from VEHICLE damage captured in a
 * fleet inspection with a SEND_TO_LD disposition. That is the wrong half of
 * the problem for the billing desk. Most L&D on this yard is GEAR: a light
 * that came back broken, three stingers that did not come back at all — and
 * the only record of it is the check-in sheet the warehouse typed in, where
 * `actualQty < expectedQty` and nothing downstream ever reads it as money.
 *
 * So the billing queue already knew: `checkInDifferences` counts exactly
 * these rows, and has been rendering them as a note ("what the client will
 * ask about") since the queue shipped. This module turns that note into
 * billable lines.
 *
 * ── Suggested, never automatic ────────────────────────────────────────────
 *
 * Every candidate arrives UNCHECKED with a suggested price, and nothing is
 * billed until Ana says so. That is not timidity, it is how short counts
 * actually behave: a piece missing on the sheet is often found on the truck
 * the next morning, and an L&D invoice that generated itself overnight would
 * bill a client for gear sitting in the yard. The sheet is evidence, not a
 * verdict — the same reason a short count does not gate the rental invoice.
 *
 * The suggested price is the inventory item's `replacementCost` when we hold
 * one. Damage lines suggest the inspection's `estimatedRepairCost`. Anything
 * with no figure comes through at 0 and says so, because a silent $0 line on
 * an invoice is worse than an obvious blank.
 */

import { prisma } from '@/lib/prisma'
import { missingOnCheckIn } from '@/lib/invoices/ldMissingGear'

export type LdCandidateSource = 'CHECK_IN_SHORT' | 'VEHICLE_DAMAGE'

export interface LdCandidate {
  /** Stable within one response — the composer keys its rows on it. */
  key: string
  source: LdCandidateSource
  description: string
  /** Unit name / category, printed as the invoice line's category. */
  category: string | null
  qty: number
  /** Suggested unit price. 0 means "we hold no figure", never "free". */
  unitPrice: number
  priced: boolean
  /** Where the suggested price came from, shown in the composer. */
  priceBasis: 'replacement cost' | 'repair estimate' | null
  /** Set for VEHICLE_DAMAGE so the generator can stamp the DamageItem. */
  damageItemId?: string
  note: string | null
}

export interface LdCandidateSet {
  orderId: string
  orderNumber: string
  jobName: string | null
  companyName: string | null
  candidates: LdCandidate[]
  /** An LD invoice already on this order — the composer refuses rather than
   *  quietly making a second one. */
  existingLdInvoice: { id: string; invoiceNumber: string; status: string; total: number } | null
  /** No inbound sheet was ever typed in, so "nothing short" here means
   *  "nobody counted", which the UI must not render as "all clear". */
  hasCheckInReport: boolean
}

export async function buildLdCandidates(orderId: string): Promise<LdCandidateSet | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      bookingId: true,
      job: { select: { name: true, company: { select: { name: true } } } },
      invoices: {
        where: { type: 'LD', NOT: { status: 'VOID' } },
        select: { id: true, invoiceNumber: true, status: true, total: true },
      },
    },
  })
  if (!order) return null

  // The inbound sheets for this order, newest first. A partial return can
  // produce several; a line short on ANY of them is short.
  const reports = await prisma.orderCheckReport.findMany({
    where: { orderId, edge: 'IN' },
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      submittedAt: true,
      lines: {
        select: {
          id: true,
          description: true,
          expectedQty: true,
          actualQty: true,
          change: true,
          note: true,
          orderLineItemId: true,
          onSheet: true,
        },
      },
    },
  })

  // SHORT *and* REMOVED: nothing back at all (0 of 3) classifies as REMOVED,
  // and filtering on SHORT alone hid the worst shortfalls. See ldMissingGear.
  const shortLines = reports.flatMap((r) =>
    missingOnCheckIn(r.lines).map((m) => ({
      ...m,
      id: r.lines.find((l) => l.orderLineItemId === m.orderLineItemId)!.id,
      reportId: r.id,
    })),
  )

  // Price the short gear at what it costs to replace. One query for every
  // line at once — the composer is opened from a queue row and must not
  // wait on a fan-out.
  const orderLineIds = shortLines.map((l) => l.orderLineItemId).filter((v): v is string => !!v)
  const orderLines = orderLineIds.length
    ? await prisma.orderLineItem.findMany({
        where: { id: { in: orderLineIds } },
        select: {
          id: true,
          description: true,
          inventoryItem: { select: { code: true, description: true, replacementCost: true } },
        },
      })
    : []
  const byLineId = new Map(orderLines.map((l) => [l.id, l]))

  const candidates: LdCandidate[] = shortLines.map((l) => {
    const missing = l.missing
    const inv = l.orderLineItemId ? byLineId.get(l.orderLineItemId)?.inventoryItem : null
    const cost = inv?.replacementCost == null ? null : Number(inv.replacementCost)
    return {
      key: `short:${l.id}`,
      source: 'CHECK_IN_SHORT',
      description: `Not returned — ${l.description}`,
      category: inv?.description ?? inv?.code ?? null,
      qty: missing,
      unitPrice: cost ?? 0,
      priced: cost != null && cost > 0,
      priceBasis: cost != null && cost > 0 ? 'replacement cost' : null,
      note: l.note || `${l.actualQty} of ${l.expectedQty} came back`,
    }
  })

  // Vehicle damage keeps its existing route into an LD invoice; it is listed
  // here too so ONE composer covers both halves of "loss and damage" and Ana
  // never has to know which subsystem captured a charge.
  if (order.bookingId) {
    const damages = await prisma.damageItem.findMany({
      where: {
        disposition: 'SEND_TO_LD',
        invoiceId: null,
        inspection: { bookingAssignment: { bookingItem: { bookingId: order.bookingId } } },
      },
      select: {
        id: true,
        locationOnVehicle: true,
        damageType: true,
        severity: true,
        estimatedRepairCost: true,
        notes: true,
        inspection: { select: { asset: { select: { unitName: true } } } },
      },
    })
    for (const d of damages) {
      const cost = d.estimatedRepairCost == null ? null : Number(d.estimatedRepairCost)
      candidates.push({
        key: `damage:${d.id}`,
        source: 'VEHICLE_DAMAGE',
        description: `Damage — ${d.damageType.toLowerCase()} (${d.severity.toLowerCase()}) at ${d.locationOnVehicle}`,
        category: d.inspection.asset?.unitName ?? null,
        qty: 1,
        unitPrice: cost ?? 0,
        priced: cost != null && cost > 0,
        priceBasis: cost != null && cost > 0 ? 'repair estimate' : null,
        damageItemId: d.id,
        note: d.notes?.trim() || null,
      })
    }
  }

  const existing = order.invoices[0]
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    jobName: order.job?.name ?? null,
    companyName: order.job?.company?.name ?? null,
    candidates,
    existingLdInvoice: existing
      ? {
          id: existing.id,
          invoiceNumber: existing.invoiceNumber,
          status: existing.status,
          total: Number(existing.total),
        }
      : null,
    hasCheckInReport: reports.length > 0,
  }
}
