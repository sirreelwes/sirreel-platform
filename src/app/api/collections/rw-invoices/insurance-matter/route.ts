import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'
import { nextClaimNumber } from '@/lib/orders'
import type { ClaimStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/collections/rw-invoices/insurance-matter — Ana's one button for
 * "this receivable is an insurance matter" (Wes, 2026-08-19).
 *
 * In order:
 *   1. Try to MATCH an existing open claim — first by this invoice number
 *      already appearing in a claim's description or notes, then by the
 *      client having exactly ONE open claim. Multiple open claims for the
 *      client is ambiguous: the invoice gets flagged but NOT linked, and Ana
 *      picks the right claim on /claims rather than the code guessing.
 *   2. No match → CREATE a minimal DRAFT claim in the tracker: company
 *      find-or-created by RW customer name, carrier "TBD", incident dated to
 *      the invoice, description carrying the full invoice reference, demand
 *      set to the outstanding balance. Same numbering + timeline + audit as
 *      the LD path (openLdClaim is not reusable here — it requires the HQ
 *      order chain, and RW-mirror invoices have none).
 *   3. Either way, the invoice's insurance flag is set with the claim
 *      number, so every collections surface badges it.
 *
 * Ana is on the claims allowlist, so the claim lands where she works it.
 */

const OPEN_STATUSES: ClaimStatus[] = ['DRAFT', 'READY_TO_SEND', 'SUBMITTED', 'ACKNOWLEDGED', 'NEGOTIATING', 'ESCALATED']

export async function POST(req: NextRequest) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { rwInvoiceId?: unknown }
  const rwInvoiceId = typeof body.rwInvoiceId === 'string' ? body.rwInvoiceId.trim() : ''
  if (!rwInvoiceId) return NextResponse.json({ ok: false, error: 'rwInvoiceId required' }, { status: 400 })

  const inv = await prisma.rwInvoice.findUnique({
    where: { rwInvoiceId },
    select: {
      invoiceNumber: true,
      customerName: true,
      dealName: true,
      orderNumber: true,
      invoiceDate: true,
      remainingTotal: true,
    },
  })
  if (!inv) return NextResponse.json({ ok: false, error: 'invoice not in the mirror' }, { status: 404 })
  if (!inv.customerName) {
    return NextResponse.json({ ok: false, error: 'invoice has no customer name — cannot open a claim' }, { status: 400 })
  }

  const setFlag = (claimNumber: string | null) =>
    prisma.rwInvoiceInsuranceFlag.upsert({
      where: { rwInvoiceId },
      create: { rwInvoiceId, claimNumber, flaggedById: user.id },
      update: { claimNumber, flaggedById: user.id, flaggedAt: new Date() },
    })

  // ── 1. Match by invoice number inside an open claim ───────────────
  if (inv.invoiceNumber) {
    const byRef = await prisma.insuranceClaim.findFirst({
      where: {
        status: { in: OPEN_STATUSES },
        OR: [
          { incidentDescription: { contains: inv.invoiceNumber } },
          { notes: { contains: inv.invoiceNumber } },
        ],
      },
      select: { id: true, claimNumber: true, filedAgainst: true, status: true },
    })
    if (byRef) {
      await setFlag(byRef.claimNumber)
      return NextResponse.json({ ok: true, matched: byRef, created: null })
    }
  }

  // ── 2. Match by the client having exactly one open claim ──────────
  const company = await prisma.company.findFirst({
    where: { name: { equals: inv.customerName.trim(), mode: 'insensitive' } },
    select: { id: true, name: true },
  })
  if (company) {
    const open = await prisma.insuranceClaim.findMany({
      where: { companyId: company.id, status: { in: OPEN_STATUSES } },
      select: { id: true, claimNumber: true, filedAgainst: true, status: true },
    })
    if (open.length === 1) {
      await setFlag(open[0].claimNumber)
      return NextResponse.json({ ok: true, matched: open[0], created: null })
    }
    if (open.length > 1) {
      // Ambiguous — flag without linking; the human picks on /claims.
      await setFlag(null)
      return NextResponse.json({ ok: true, matched: null, created: null, ambiguous: open })
    }
  }

  // ── 3. No match → create the claim tracker ────────────────────────
  const companyId =
    company?.id ??
    (
      await prisma.company.create({
        data: { name: inv.customerName.trim() },
        select: { id: true },
      })
    ).id

  const claimNumber = await nextClaimNumber()
  const description =
    `Opened from collections aging review: RW invoice ${inv.invoiceNumber ?? rwInvoiceId}` +
    (inv.dealName ? ` (${inv.dealName})` : '') +
    (inv.orderNumber ? `, RW order ${inv.orderNumber}` : '') +
    ` — $${Number(inv.remainingTotal).toFixed(2)} outstanding, flagged as an insurance matter.`

  const claim = await prisma.$transaction(async (tx) => {
    const c = await tx.insuranceClaim.create({
      data: {
        claimNumber,
        companyId,
        status: 'DRAFT',
        // The carrier is usually unknown at flag time — Ana fills it in on
        // the claim page once she has the adjuster. "TBD" is honest and
        // satisfies the schema without inventing a carrier.
        filedAgainst: 'TBD — carrier not yet identified',
        incidentDate: inv.invoiceDate ?? new Date(),
        incidentDescription: description,
        totalDemand: Number(inv.remainingTotal),
      },
      select: { id: true, claimNumber: true, filedAgainst: true, status: true },
    })
    await tx.claimTimeline.create({
      data: {
        claimId: c.id,
        action: 'CREATED',
        description: `Opened from collections aging review (RW invoice ${inv.invoiceNumber ?? rwInvoiceId}).`,
        performedBy: user.id,
      },
    })
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'claim.opened',
        entityType: 'InsuranceClaim',
        entityId: c.id,
        newValues: { claimNumber: c.claimNumber, source: 'aging-review', rwInvoiceId },
      },
    })
    return c
  })

  await setFlag(claim.claimNumber)
  return NextResponse.json({ ok: true, matched: null, created: claim })
}
