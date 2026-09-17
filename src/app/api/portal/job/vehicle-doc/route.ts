/**
 * GET /api/portal/job/vehicle-doc?assetId=…&kind=registration|bit-certificate
 *
 * Job-session-gated proxy for a reserved vehicle's DOT paperwork — the
 * registration and the current BIT certificate the client keeps in the cab.
 * Both are PRIVATE blobs that 403 in a browser, so the portal payload carries
 * this href (portalDocHref) and never the stored URL.
 *
 * THE ASSET ID COMES OFF THE QUERY STRING, so "may this session read this
 * unit?" is a security check, not a display filter. It is answered with the
 * SAME rule the portal page uses to decide which trucks to list
 * (narrowAssignmentsToOrder): this order's stamped units, else the unstamped
 * ones, never a sibling order's. Guessing another job's assetId gets a 404.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveJobPortalRead } from '@/lib/portal/jobPreview'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import {
  VEHICLE_DOC_LABEL,
  narrowAssignmentsToOrder,
  parseVehicleDocKind,
  vehicleDocFilename,
} from '@/lib/fleet/vehicleDocs'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const read = await resolveJobPortalRead(req)
  if (!read) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const resolved = read.resolved
  if (!resolved) return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })

  const assetId = (req.nextUrl.searchParams.get('assetId') || '').trim()
  const kind = parseVehicleDocKind(req.nextUrl.searchParams.get('kind'))
  if (!assetId || !kind) {
    return NextResponse.json({ error: 'assetId and kind are required' }, { status: 400 })
  }

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: { id: true, bookingId: true },
  })
  if (!order?.bookingId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Same scope as the page: this order's booking, live assignments, vehicles.
  const onBooking = await prisma.bookingAssignment.findMany({
    where: {
      bookingItem: { bookingId: order.bookingId },
      status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      asset: { category: { department: 'VEHICLES' } },
    },
    select: { orderId: true, assetId: true },
  })
  const mine = narrowAssignmentsToOrder(onBooking, [order.id, resolved.followedFrom?.id])
  if (!mine.some((a) => a.assetId === assetId)) {
    // Deliberately indistinguishable from "no such unit" — a client learning
    // that an assetId is real but not theirs is a fact they have no use for.
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: {
      unitName: true,
      registrationUrl: true,
      registrationExpiresAt: true,
      bitCertificateUrl: true,
      bitCertificateExpiresAt: true,
    },
  })
  const fileUrl = kind === 'registration' ? asset?.registrationUrl : asset?.bitCertificateUrl
  const expiresAt = kind === 'registration' ? asset?.registrationExpiresAt : asset?.bitCertificateExpiresAt
  if (!asset || !fileUrl) {
    return NextResponse.json({ error: `No ${VEHICLE_DOC_LABEL[kind].toLowerCase()} on file` }, { status: 404 })
  }

  return streamPrivateBlobAsResponse({
    fileUrl,
    filename: vehicleDocFilename({ unitName: asset.unitName, kind, expiresAt }),
  })
}
