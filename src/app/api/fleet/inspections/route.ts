/**
 * Sprint 2A — pre-rental inspection API.
 *
 * POST — create the CHECKOUT inspection for a booking assignment:
 *   Inspection (type CHECKOUT, linked to assignment + asset + user)
 *   + DamageItem rows for pre-existing damage (isPreExisting=true,
 *     disposition WAIVED — pre-rental damage is by definition not
 *     billable to this renter)
 *   + CheckoutRecord (driverId null until physical pickup;
 *     checkoutInspectionId wired).
 *   Role-gated: ADMIN / MANAGER / DISPATCHER / FLEET_TECH only.
 *
 * GET ?orderId= — inspections for the order's linked booking, for the
 *   internal order-detail "Inspections" panel. Any signed-in staff
 *   session (read-only surface on an internal page).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { list } from '@vercel/blob'
import type { DamageSeverity, DamageType, VehicleCondition } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireFleetInspectionAccess } from '@/lib/fleet/requireFleetInspectionAccess'

export const dynamic = 'force-dynamic'

const VALID_CONDITIONS = new Set(['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'])
const VALID_DAMAGE_TYPES = new Set(['SCRATCH', 'DENT', 'CRACK', 'MISSING_PART', 'MECHANICAL', 'INTERIOR', 'OTHER'])
const VALID_SEVERITIES = new Set(['MINOR', 'MODERATE', 'MAJOR'])
const VALID_FUEL = new Set(['full', '3/4', '1/2', '1/4', 'empty'])

export async function POST(req: NextRequest) {
  const auth = await requireFleetInspectionAccess()
  if (!auth.ok) return auth.response

  const body = await req.json().catch(() => null) as {
    bookingAssignmentId?: string
    overallCondition?: string
    mileage?: number | string | null
    fuelLevel?: string | null
    notes?: string | null
    damages?: { location?: string; damageType?: string; severity?: string; notes?: string | null }[]
    // Blob keys returned by /api/fleet/inspections/photos/stage — the
    // photos already uploaded as they were taken; finalize only links
    // them, it never receives bytes.
    stagedPhotos?: { key?: string; filename?: string | null; contentType?: string | null }[]
  } | null
  if (!body?.bookingAssignmentId) {
    return NextResponse.json({ error: 'bookingAssignmentId required' }, { status: 400 })
  }
  if (!body.overallCondition || !VALID_CONDITIONS.has(body.overallCondition)) {
    return NextResponse.json({ error: 'overallCondition required (EXCELLENT/GOOD/FAIR/POOR/DAMAGED)' }, { status: 400 })
  }
  if (body.fuelLevel != null && body.fuelLevel !== '' && !VALID_FUEL.has(body.fuelLevel)) {
    return NextResponse.json({ error: 'fuelLevel must be one of full, 3/4, 1/2, 1/4, empty' }, { status: 400 })
  }
  const damages = (body.damages ?? []).filter((d) => d.location?.trim())
  for (const d of damages) {
    if (!VALID_DAMAGE_TYPES.has(d.damageType ?? '')) {
      return NextResponse.json({ error: `invalid damageType on "${d.location}"` }, { status: 400 })
    }
    if (!VALID_SEVERITIES.has(d.severity ?? '')) {
      return NextResponse.json({ error: `invalid severity on "${d.location}"` }, { status: 400 })
    }
  }
  const mileage =
    body.mileage != null && body.mileage !== '' && Number.isFinite(Number(body.mileage))
      ? Math.max(0, Math.floor(Number(body.mileage)))
      : null

  const assignment = await prisma.bookingAssignment.findUnique({
    where: { id: body.bookingAssignmentId },
    select: { id: true, assetId: true },
  })
  if (!assignment) {
    return NextResponse.json({ error: 'booking assignment not found' }, { status: 404 })
  }

  const existing = await prisma.inspection.findFirst({
    where: { bookingAssignmentId: assignment.id, type: 'CHECKOUT' },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json(
      { error: 'checkout inspection already exists for this assignment', inspectionId: existing.id },
      { status: 409 },
    )
  }

  const result = await prisma.$transaction(async (tx) => {
    const inspection = await tx.inspection.create({
      data: {
        assetId: assignment.assetId,
        bookingAssignmentId: assignment.id,
        type: 'CHECKOUT',
        inspectedBy: auth.userId,
        inspectionDate: new Date(),
        overallCondition: body.overallCondition as VehicleCondition,
        mileageAtInspection: mileage,
        fuelLevel: body.fuelLevel || null,
        // Pre-rental capture documents EXISTING condition — this is not
        // "new damage found on return".
        newDamageFound: false,
        notes: body.notes?.trim() || null,
      },
      select: { id: true },
    })
    if (damages.length) {
      await tx.damageItem.createMany({
        data: damages.map((d) => ({
          inspectionId: inspection.id,
          locationOnVehicle: d.location!.trim(),
          damageType: d.damageType as DamageType,
          severity: d.severity as DamageSeverity,
          notes: d.notes?.trim() || null,
          isPreExisting: true,
          disposition: 'WAIVED' as const,
        })),
      })
    }
    const checkout = await tx.checkoutRecord.create({
      data: {
        bookingAssignmentId: assignment.id,
        assetId: assignment.assetId,
        driverId: null, // attached at physical pickup (Sprint 2B)
        checkedOutBy: auth.userId,
        checkoutTime: new Date(),
        mileageOut: mileage,
        fuelOut: body.fuelLevel || null,
        checkoutInspectionId: inspection.id,
      },
      select: { id: true },
    })
    return { inspectionId: inspection.id, checkoutRecordId: checkout.id }
  })

  // Attach staged photos AFTER the transaction (blob listing is a network
  // call). Keys are only honored when they sit under THIS assignment's
  // staging prefix AND actually exist in the store — the client can't
  // point a photo row at an arbitrary URL.
  const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
  const stagedPrefix = `fleet-inspections/staged/${assignment.id}/`
  const requested = (body.stagedPhotos ?? [])
    .filter((p): p is { key: string; filename?: string | null; contentType?: string | null } =>
      typeof p?.key === 'string' && p.key.startsWith(stagedPrefix))
    .slice(0, 50)
  let photosAttached = 0
  let photosMissing = 0
  if (requested.length) {
    const { blobs } = await list({ prefix: stagedPrefix, limit: 1000 })
    const byPath = new Map(blobs.map((b) => [b.pathname, b]))
    const rows = []
    for (const p of requested) {
      const blob = byPath.get(p.key)
      if (!blob) { photosMissing++; continue }
      rows.push({
        inspectionId: result.inspectionId,
        fileUrl: blob.url,
        filename: p.filename?.slice(0, 80) || p.key.split('/').pop() || 'photo',
        contentType: p.contentType && ALLOWED_PHOTO_TYPES.has(p.contentType) ? p.contentType : null,
        uploadedBy: auth.userId,
      })
    }
    if (rows.length) {
      await prisma.inspectionPhoto.createMany({ data: rows })
      photosAttached = rows.length
    }
  }

  return NextResponse.json(
    { ok: true, ...result, damageCount: damages.length, photosAttached, photosMissing },
    { status: 201 },
  )
}

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const orderId = new URL(req.url).searchParams.get('orderId')
  if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 })

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { bookingId: true },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })
  if (!order.bookingId) return NextResponse.json({ inspections: [] })

  const inspections = await prisma.inspection.findMany({
    where: {
      type: 'CHECKOUT',
      bookingAssignment: { bookingItem: { bookingId: order.bookingId } },
    },
    orderBy: { inspectionDate: 'desc' },
    select: {
      id: true,
      inspectionDate: true,
      overallCondition: true,
      mileageAtInspection: true,
      fuelLevel: true,
      notes: true,
      inspectedByUser: { select: { name: true, email: true } },
      bookingAssignment: {
        select: { id: true, asset: { select: { unitName: true } } },
      },
      photos: { select: { id: true, filename: true }, orderBy: { createdAt: 'asc' } },
      damageItems: {
        where: { isPreExisting: true },
        select: { id: true, locationOnVehicle: true, damageType: true, severity: true, notes: true },
      },
    },
  })
  return NextResponse.json({ inspections })
}
