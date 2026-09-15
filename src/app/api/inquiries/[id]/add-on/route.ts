/**
 * POST /api/inquiries/[id]/add-on
 *
 * Triage action: convert an inquiry into a new Order on an
 * EXISTING Job ("add-on") instead of spinning up a new Job. The
 * companion to the existing "new Job" convert flow that lives in
 * /orders/new-quote — both paths end up routing the rep to the
 * order detail / quote builder; the difference is which Job the
 * order lives on.
 *
 * Body: { jobId: string }   — required, must reference a Job whose
 *                              status is not WRAPPED/LOST so we don't
 *                              attach holds to wrapped shows.
 *
 * Side effects (all in one tx so a partial failure rolls back):
 *   1. Create a new Order on jobId via the same path /api/orders
 *      uses — `nextOrderNumber(tx)` for the date-based number,
 *      taxRate=0, companyId+agentId derived from the Job's record,
 *      addedToJobAt=now (this is what marks it as an add-on).
 *   2. PATCH the Inquiry: status=CONVERTED, convertedOrderId=<new>.
 *
 * Agent assignment: prefer Inquiry.assignedToId (the agent who owned
 * the inquiry); fall back to the acting user. Matches the new-Job
 * path's "agent of record" semantics.
 *
 * Web-form carts (sourceMetadata.kind production-order / supply-order
 * with a non-empty cart) do NOT take this path: nothing is written, and
 * the rep is sent to /orders/new?inquiryId=…&jobId=… instead, where the
 * builder seeds the cart lines onto the picked job and the save mints
 * the vehicle holds and closes the inquiry (convertedOrderId). The blank
 * order this route creates never got the cart — SR-REQ-0064 (ONA
 * Creative, 2 SuperCubes) converted on 2026-09-15 into an empty DRAFT
 * and dropped out of New inbound, so the request looked lost.
 *
 * Contact handling: deliberately NOT touched. The rep manages
 * contacts in the quote builder — auto-attaching the inquirer as a
 * JobContact on an existing job would surprise reps who triage to a
 * Job the inquirer isn't actually associated with. Mirrors the
 * new-Job convert path's "leave contacts to the rep" policy.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { nextOrderNumber } from '@/lib/orders'
import { applyStandingDiscounts } from '@/lib/orders/applyStandingDiscounts'

type Params = { params: Promise<{ id: string }> }

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!me) return NextResponse.json({ error: 'session user not found' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { jobId?: unknown }
  const jobId = typeof body.jobId === 'string' && body.jobId.trim() ? body.jobId.trim() : null
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  // Load both rows up front so we can validate before opening the tx.
  const [inquiry, job] = await Promise.all([
    prisma.inquiry.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        assignedToId: true,
        convertedJobId: true,
        convertedOrderId: true,
        sourceMetadata: true,
      },
    }),
    prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, companyId: true, agentId: true, name: true, jobCode: true },
    }),
  ])
  if (!inquiry) return NextResponse.json({ error: 'inquiry not found' }, { status: 404 })
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })
  // Reject add-ons to terminal jobs — same rule the JobPicker enforces
  // in its search filter.
  if (job.status === 'WRAPPED' || job.status === 'LOST') {
    return NextResponse.json(
      { error: `job ${job.jobCode} is ${job.status} — pick an open job` },
      { status: 409 },
    )
  }
  if (inquiry.status === 'CONVERTED') {
    return NextResponse.json(
      { error: 'inquiry is already converted', existingOrderId: inquiry.convertedOrderId },
      { status: 409 },
    )
  }

  // A web-form cart goes through the order builder (see header) — no
  // blank order, and the inquiry stays open until that order is saved.
  const meta = inquiry.sourceMetadata as { kind?: unknown; cart?: unknown } | null
  if (
    (meta?.kind === 'production-order' || meta?.kind === 'supply-order') &&
    Array.isArray(meta.cart) &&
    meta.cart.length > 0
  ) {
    return NextResponse.json({
      ok: true,
      order: null,
      inquiry: { id: inquiry.id, status: inquiry.status, convertedOrderId: null },
      redirectTo: `/orders/new?inquiryId=${encodeURIComponent(inquiry.id)}&jobId=${encodeURIComponent(job.id)}`,
    })
  }

  const agentId = inquiry.assignedToId ?? me.id

  const result = await prisma.$transaction(async (tx) => {
    const orderNumber = await nextOrderNumber(tx)
    const order = await tx.order.create({
      data: {
        orderNumber,
        companyId: job.companyId,
        agentId,
        jobId: job.id,
        taxRate: 0,
        // The mark that makes this an add-on. Drives the "Add-on" chip
        // rendered on the order list + detail.
        addedToJobAt: new Date(),
      },
      select: { id: true, orderNumber: true, jobId: true, companyId: true },
    })
    // Standing company discounts, seeded with the order.
    await applyStandingDiscounts(order.id, job.companyId, tx)
    const updatedInquiry = await tx.inquiry.update({
      where: { id: inquiry.id },
      data: {
        status: 'CONVERTED',
        convertedOrderId: order.id,
      },
      select: { id: true, status: true, convertedOrderId: true },
    })
    return { order, inquiry: updatedInquiry }
  })

  return NextResponse.json(
    {
      ok: true,
      order: result.order,
      inquiry: result.inquiry,
      // Same shape the new-quote flow uses when routing the rep
      // after a convert — the client redirects to the order detail
      // page to add line items.
      redirectTo: `/orders/${result.order.id}`,
    },
    { status: 201 },
  )
}
