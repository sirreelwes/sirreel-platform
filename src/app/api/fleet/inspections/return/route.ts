/**
 * POST /api/fleet/inspections/return — the return-side inspection.
 *
 * The sibling of the CHECKOUT route next door, kept separate rather
 * than folded in behind a `type` flag: almost every branch differs.
 * Checkout MINTS the CheckoutRecord and files its damage as
 * pre-existing and WAIVED (by definition not this renter's fault);
 * return CLOSES that record and files its damage as new and PENDING,
 * which is what puts it in front of whoever bills. Sharing one handler
 * would mean a conditional on nearly every line.
 *
 * What it does, in one transaction:
 *   - Inspection (type RETURN), newDamageFound set from the damage list
 *   - DamageItem rows: isPreExisting = false, disposition = PENDING —
 *     the triage queue picks them up from there
 *   - CheckoutRecord closed: returnTime, mileageIn, fuelIn,
 *     returnInspectionId, returnedTo, newDamageOnReturn. Columns that
 *     have existed since the model was written and were never filled.
 *   - BookingAssignment → RETURNED, which is what takes the unit off
 *     the yard board and frees it on the availability side.
 *
 * Then, outside the transaction: staged photos are attached, and
 * settleJobReturn decides whether this was the last thing outstanding
 * on the job.
 *
 * A truck with NO checkout inspection is still accepted. Five of one
 * recent day's departures left uninspected; refusing their return would
 * mean the only record of how they came back is no record at all.
 */

import { NextRequest, NextResponse } from 'next/server'
import { list } from '@vercel/blob'
import type { DamageSeverity, DamageType, VehicleCondition } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireFleetInspectionAccess } from '@/lib/fleet/requireFleetInspectionAccess'
import { settleJobReturnSafe } from '@/lib/fleet/settleJobReturn'

export const dynamic = 'force-dynamic'

const VALID_CONDITIONS = new Set(['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'])
const VALID_DAMAGE_TYPES = new Set(['SCRATCH', 'DENT', 'CRACK', 'MISSING_PART', 'MECHANICAL', 'INTERIOR', 'OTHER'])
const VALID_SEVERITIES = new Set(['MINOR', 'MODERATE', 'MAJOR'])
const VALID_FUEL = new Set(['full', '3/4', '1/2', '1/4', 'empty'])
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

export async function POST(req: NextRequest) {
  const auth = await requireFleetInspectionAccess()
  if (!auth.ok) return auth.response

  const body = (await req.json().catch(() => null)) as {
    bookingAssignmentId?: string
    overallCondition?: string
    mileage?: number | string | null
    fuelLevel?: string | null
    notes?: string | null
    damages?: { location?: string; damageType?: string; severity?: string; notes?: string | null }[]
    stagedPhotos?: { key?: string; filename?: string | null; contentType?: string | null }[]
  } | null

  if (!body?.bookingAssignmentId) {
    return NextResponse.json({ error: 'bookingAssignmentId required' }, { status: 400 })
  }
  if (!body.overallCondition || !VALID_CONDITIONS.has(body.overallCondition)) {
    return NextResponse.json(
      { error: 'overallCondition required (EXCELLENT/GOOD/FAIR/POOR/DAMAGED)' },
      { status: 400 },
    )
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
    select: {
      id: true,
      assetId: true,
      bookingItem: { select: { booking: { select: { jobId: true } } } },
    },
  })
  if (!assignment) {
    return NextResponse.json({ error: 'booking assignment not found' }, { status: 404 })
  }

  const existing = await prisma.inspection.findFirst({
    where: { bookingAssignmentId: assignment.id, type: 'RETURN' },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json(
      { error: 'this unit has already been checked in', inspectionId: existing.id },
      { status: 409 },
    )
  }

  // The checkout record this return closes. Absent when the unit went
  // out without a pre-rental inspection — the return is still recorded,
  // there is simply nothing to close.
  const checkoutRecord = await prisma.checkoutRecord.findFirst({
    where: { bookingAssignmentId: assignment.id, returnTime: null },
    orderBy: { checkoutTime: 'desc' },
    select: { id: true },
  })

  const newDamageFound = damages.length > 0

  const result = await prisma.$transaction(async (tx) => {
    const inspection = await tx.inspection.create({
      data: {
        assetId: assignment.assetId,
        bookingAssignmentId: assignment.id,
        type: 'RETURN',
        inspectedBy: auth.userId,
        inspectionDate: new Date(),
        overallCondition: body.overallCondition as VehicleCondition,
        mileageAtInspection: mileage,
        fuelLevel: body.fuelLevel || null,
        newDamageFound,
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
          // The inverse of the checkout route on both counts: damage
          // found on return is NEW, and it is PENDING triage rather
          // than waived — somebody decides whether it gets billed.
          isPreExisting: false,
          disposition: 'PENDING' as const,
        })),
      })
    }

    if (checkoutRecord) {
      await tx.checkoutRecord.update({
        where: { id: checkoutRecord.id },
        data: {
          returnTime: new Date(),
          mileageIn: mileage,
          fuelIn: body.fuelLevel || null,
          returnInspectionId: inspection.id,
          returnedTo: auth.userId,
          newDamageOnReturn: newDamageFound,
        },
      })
    }

    await tx.bookingAssignment.update({
      where: { id: assignment.id },
      data: { status: 'RETURNED' },
    })

    return { inspectionId: inspection.id, checkoutRecordId: checkoutRecord?.id ?? null }
  })

  // Photos attach after the transaction — the blob listing is a network
  // call. Keys are honoured only under THIS assignment's staging prefix
  // and only when they exist in the store, so a client cannot point a
  // photo row at an arbitrary URL. Same contract as the checkout route.
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
      if (!blob) {
        photosMissing++
        continue
      }
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

  const settled = await settleJobReturnSafe(assignment.bookingItem.booking.jobId, auth.userId)

  return NextResponse.json(
    {
      ok: true,
      ...result,
      damageCount: damages.length,
      newDamageFound,
      photosAttached,
      photosMissing,
      // Lets the confirmation screen say "that was the last one" rather
      // than leaving the crew guessing whether the job is closed out.
      jobReturned: settled.stamped,
      jobPending: settled.reason === 'vehicles-out' || settled.reason === 'gear-open' ? settled.reason : null,
    },
    { status: 201 },
  )
}
