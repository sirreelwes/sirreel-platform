/**
 * GET /api/jobs/[id]/sub-rentals — every partner-sourced fulfillment on a job.
 *
 * Until this existed there was no HQ surface for a sub-rental at all: rows were
 * created from an order line and then only observable by querying the database.
 * Nobody could see that a partner had been asked to hold, let alone that the
 * ask had FAILED — which is the state that actually costs a shoot day.
 *
 * SCOPE — a sub-rental reaches a job two different ways and both must be here:
 *   · jobId set          — the estimate flow, which hangs the row off the JOB
 *                          because a quote exists before any order does.
 *   · orderId → order.jobId — the older line-level flow (POST /api/sub-rentals),
 *                          which sets orderId and NEVER sets jobId.
 * Querying only jobId silently drops every line-created sub-rental; the live
 * "2 Unit Restroom Trailer" row is exactly that shape.
 *
 * Auth: requireSubRentalAccess — Hugo (MANAGER) takes custody of these units
 * and must see them. He does NOT have seePricing, so vendor and client money
 * is selected only for callers who do, rather than sent down and hidden in CSS.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSubRentalAccess } from '@/lib/sub-rentals/auth'
import { getPermissions } from '@/lib/permissions'
import { relayAddress } from '@/lib/sub-rentals/driverRelay'
import { vendorPagePath } from '@/lib/sub-rentals/potentialSubRental'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'
import { isClientCommittedOrder } from '@/lib/sub-rentals/commitment'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireSubRentalAccess()
  if (gate instanceof NextResponse) return gate
  const { user } = gate
  const seePricing = getPermissions({
    role: user.role,
    salesOnly: user.salesOnly,
    email: user.email,
  }).seePricing

  const rows = await prisma.subRental.findMany({
    where: { OR: [{ jobId: params.id }, { order: { jobId: params.id } }] },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      status: true,
      itemDescription: true,
      quantity: true,
      startDate: true,
      endDate: true,
      receiveMethod: true,
      poNumber: true,
      notes: true,
      vendorToken: true,
      vendorNotifiedAt: true,
      vendorHoldRequestedAt: true,
      driverName: true,
      driverEmail: true,
      driverPhone: true,
      driverAssignedAt: true,
      relayTag: true,
      vendorTotal: seePricing,
      clientTotal: seePricing,
      vendor: { select: { id: true, name: true, email: true, poEmail: true, phone: true } },
      subcontractedVehicle: { select: { id: true, name: true } },
      order: { select: { id: true, orderNumber: true, status: true } },
      orderLineItem: { select: { id: true, description: true } },
    },
  })

  // Has the CLIENT committed? Read off the orders, not the sub-rental: a row
  // quoted from the estimate flow hangs off the job with no order at all, and
  // the approval hook binds those by jobId — so for them, any committed order
  // on the job is the client's yes. This is what lets the panel shout about an
  // ESTIMATED row on a booked job, which is exactly the state an HQ-side
  // approval used to leave behind with nobody the wiser.
  const jobOrders = await prisma.order.findMany({
    where: { jobId: params.id, archivedAt: null },
    select: { status: true },
  })
  const jobCommitted = jobOrders.some((o) => isClientCommittedOrder(o.status))

  return NextResponse.json({
    seePricing,
    subRentals: rows.map((r) => ({
      ...r,
      vendorTotal: r.vendorTotal ? Number(r.vendorTotal) : null,
      clientTotal: r.clientTotal ? Number(r.clientTotal) : null,
      vehicleName: r.subcontractedVehicle?.name ?? r.itemDescription,
      // Staff-only: the vendor page IS the credential, so this URL is the
      // thing a rep pastes when a partner loses the email. Never leaves an
      // authenticated response.
      vendorUrl: r.vendorToken ? `${PUBLIC_SITE_ORIGIN}${vendorPagePath(r.vendorToken)}` : null,
      relayAddress: r.relayTag ? relayAddress(r.relayTag) : null,
      clientCommitted: r.order ? isClientCommittedOrder(r.order.status) : jobCommitted,
    })),
  })
}
