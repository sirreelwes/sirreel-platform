/**
 * openLdClaim — Phase 5 commit 4. Creates an InsuranceClaim attached
 * to an LD invoice and (when available) the COI on file. Pipeline
 * stays DRAFT by default; operators move it through SUBMITTED →
 * NEGOTIATING → SETTLED via subsequent updates.
 *
 * Doctrine — NON-BLOCKING. An open claim never gates Order.status.
 * The rental arc reaches CLOSED via the RENTAL invoice's payment;
 * this claim rides the LD invoice on its own pipeline.
 *
 * Inputs deliberately minimal:
 *   - invoiceId (must be an LD invoice, must not already have a claim
 *     attached — one claim per LD invoice)
 *   - filedAgainst (insurance company name)
 *   - incidentDate
 *   - incidentDescription
 *
 * The asset + booking + company FKs that InsuranceClaim requires get
 * derived from the invoice's order. checkout/return inspection ids
 * are nullable now (Phase 5 commit 4 schema change), so we don't
 * require those at create.
 *
 * READ-ONLY against Order.booked* + invoice totals.
 */

import type { ClaimStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { nextClaimNumber } from '@/lib/orders'

export type OpenLdClaimResult =
  | {
      ok: true
      claimId: string
      claimNumber: string
    }
  | { ok: false; status: number; error: string }

export async function openLdClaim(args: {
  invoiceId: string
  filedAgainst: string
  incidentDate: Date
  incidentDescription: string
  /** Optional adjuster details. Phase 5 commit 4 leaves these
   *  blank-by-default; Ana fills them in via the claim detail page
   *  (existing /claims surface) once the carrier responds. */
  adjusterName?: string | null
  adjusterPhone?: string | null
  adjusterEmail?: string | null
  policyNumber?: string | null
  /** When omitted, the helper finds the most-recent COI on file for
   *  the invoice's order/company/job and uses it. Pass null to
   *  explicitly skip the COI linkage. */
  coiCheckId?: string | null | undefined
  /** When omitted, the helper picks the first RETURN inspection it
   *  finds on any DamageItem already attached to this invoice. */
  assetId?: string | null
  recordedById: string
}): Promise<OpenLdClaimResult> {
  const { invoiceId, filedAgainst, incidentDate, incidentDescription, recordedById } = args

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      type: true,
      orderId: true,
      order: {
        select: {
          id: true,
          companyId: true,
          bookingId: true,
          jobId: true,
        },
      },
      damageItems: {
        select: {
          id: true,
          inspection: {
            select: {
              id: true,
              assetId: true,
              type: true,
            },
          },
        },
      },
      insuranceClaims: { select: { id: true } },
    },
  })
  if (!invoice) return { ok: false, status: 404, error: 'invoice not found' }
  if (invoice.type !== 'LD') {
    return { ok: false, status: 409, error: 'claims attach only to LD invoices' }
  }
  if (invoice.insuranceClaims.length > 0) {
    return {
      ok: false,
      status: 409,
      error: 'this LD invoice already has a claim attached',
    }
  }
  if (!invoice.order.bookingId) {
    return { ok: false, status: 409, error: 'order has no Booking — required for claim' }
  }

  // Resolve asset: caller override, else first damage's RETURN
  // inspection asset.
  const assetId =
    args.assetId ??
    invoice.damageItems.find((d) => d.inspection.type === 'RETURN')?.inspection.assetId ??
    invoice.damageItems[0]?.inspection.assetId ??
    null
  if (!assetId) {
    return {
      ok: false,
      status: 409,
      error: 'no asset reachable through invoice damages — capture damage findings first',
    }
  }

  // Resolve COI: caller override (including explicit null), else
  // most-recent non-deleted CoiCheck linked to job or company.
  let coiCheckId: string | null = args.coiCheckId ?? null
  if (args.coiCheckId === undefined) {
    const coi = await prisma.coiCheck.findFirst({
      where: {
        deletedAt: null,
        OR: [
          invoice.order.jobId ? { jobId: invoice.order.jobId } : { id: '__none__' },
          { companyId: invoice.order.companyId },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    coiCheckId = coi?.id ?? null
  }

  // Resolve return inspection id from the damage chain (just for
  // convenience — schema now allows null).
  const returnInspectionId =
    invoice.damageItems.find((d) => d.inspection.type === 'RETURN')?.inspection.id ?? null

  const claimNumber = await nextClaimNumber()

  const result = await prisma.$transaction(async (tx) => {
    const claim = await tx.insuranceClaim.create({
      data: {
        claimNumber,
        bookingId: invoice.order.bookingId!,
        assetId,
        companyId: invoice.order.companyId,
        invoiceId: invoice.id,
        coiCheckId,
        returnInspectionId,
        // checkoutInspectionId stays null — minimum data set
        status: 'DRAFT' satisfies ClaimStatus,
        filedAgainst,
        adjusterName: args.adjusterName ?? null,
        adjusterPhone: args.adjusterPhone ?? null,
        adjusterEmail: args.adjusterEmail ?? null,
        policyNumber: args.policyNumber ?? null,
        incidentDate,
        incidentDescription,
      },
      select: { id: true, claimNumber: true },
    })
    // Connect all SEND_TO_LD damage items billed on this invoice to
    // the claim — gives the existing damageItem.claimId path data so
    // the /claims surface can group them.
    await tx.damageItem.updateMany({
      where: { invoiceId: invoice.id },
      data: { claimId: claim.id },
    })
    await tx.claimTimeline.create({
      data: {
        claimId: claim.id,
        action: 'CREATED',
        description: `Opened from LD invoice ${invoice.id}; filed against ${filedAgainst}.`,
        performedBy: recordedById,
      },
    })
    await tx.auditLog.create({
      data: {
        userId: recordedById,
        action: 'claim.opened',
        entityType: 'InsuranceClaim',
        entityId: claim.id,
        newValues: {
          claimNumber: claim.claimNumber,
          invoiceId: invoice.id,
          coiCheckId,
          filedAgainst,
        },
      },
    })
    return claim
  })

  return { ok: true, claimId: result.id, claimNumber: result.claimNumber }
}
