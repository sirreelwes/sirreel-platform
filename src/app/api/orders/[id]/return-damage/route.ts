/**
 * POST /api/orders/[id]/return-damage  — capture damage findings.
 * GET  /api/orders/[id]/return-damage  — list damages + dispositions
 *                                        + assignment context.
 *
 * Phase 5 commit 4 — feeds the LD disposition surface on the order
 * detail page.
 *
 * Auth: any authenticated session.
 *
 * POST body:
 *   {
 *     bookingAssignmentId: string,
 *     overallCondition?: VehicleCondition,
 *     mileageAtInspection?: number,
 *     fuelLevel?: string,
 *     findings: [{
 *       locationOnVehicle, damageType, severity,
 *       estimatedRepairCost?, photoUrl?, notes?,
 *       isPreExisting?, disposition?
 *     }, ...]
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { DamageType, DamageSeverity, DamageDisposition, VehicleCondition } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { captureReturnDamage } from '@/lib/inspections/captureReturnDamage'

export const dynamic = 'force-dynamic'

const DAMAGE_TYPES: DamageType[] = ['SCRATCH', 'DENT', 'CRACK', 'MISSING_PART', 'MECHANICAL', 'INTERIOR', 'OTHER']
const SEVERITIES: DamageSeverity[] = ['MINOR', 'MODERATE', 'MAJOR']
const DISPOSITIONS: DamageDisposition[] = ['PENDING', 'BILL_NOW', 'SEND_TO_LD', 'WAIVED']
const CONDITIONS: VehicleCondition[] = ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'DAMAGED']

interface RawFinding {
  locationOnVehicle?: unknown
  damageType?: unknown
  severity?: unknown
  estimatedRepairCost?: unknown
  photoUrl?: unknown
  notes?: unknown
  isPreExisting?: unknown
  disposition?: unknown
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    bookingAssignmentId?: unknown
    overallCondition?: unknown
    mileageAtInspection?: unknown
    fuelLevel?: unknown
    findings?: unknown
  }

  const bookingAssignmentId =
    typeof body.bookingAssignmentId === 'string' ? body.bookingAssignmentId : null
  if (!bookingAssignmentId) {
    return NextResponse.json({ error: 'bookingAssignmentId required' }, { status: 400 })
  }
  const overallCondition =
    typeof body.overallCondition === 'string' && CONDITIONS.includes(body.overallCondition as VehicleCondition)
      ? (body.overallCondition as VehicleCondition)
      : undefined
  const mileageAtInspection =
    typeof body.mileageAtInspection === 'number' ? body.mileageAtInspection : null
  const fuelLevel =
    typeof body.fuelLevel === 'string' && body.fuelLevel.trim().length > 0
      ? body.fuelLevel.trim().slice(0, 20)
      : null

  const rawFindings = Array.isArray(body.findings) ? (body.findings as RawFinding[]) : []
  if (rawFindings.length === 0) {
    return NextResponse.json({ error: 'at least one finding required' }, { status: 400 })
  }
  const findings: Parameters<typeof captureReturnDamage>[0]['findings'] = []
  for (const f of rawFindings) {
    const location = typeof f.locationOnVehicle === 'string' ? f.locationOnVehicle.trim() : ''
    if (!location) {
      return NextResponse.json({ error: 'each finding needs locationOnVehicle' }, { status: 400 })
    }
    const dt = typeof f.damageType === 'string' && DAMAGE_TYPES.includes(f.damageType as DamageType)
      ? (f.damageType as DamageType)
      : null
    if (!dt) {
      return NextResponse.json({ error: `damageType required (one of ${DAMAGE_TYPES.join(', ')})` }, { status: 400 })
    }
    const sev = typeof f.severity === 'string' && SEVERITIES.includes(f.severity as DamageSeverity)
      ? (f.severity as DamageSeverity)
      : null
    if (!sev) {
      return NextResponse.json({ error: `severity required (one of ${SEVERITIES.join(', ')})` }, { status: 400 })
    }
    const erc = typeof f.estimatedRepairCost === 'number' && Number.isFinite(f.estimatedRepairCost)
      ? f.estimatedRepairCost
      : null
    const disp =
      typeof f.disposition === 'string' && DISPOSITIONS.includes(f.disposition as DamageDisposition)
        ? (f.disposition as DamageDisposition)
        : undefined
    findings.push({
      locationOnVehicle: location.slice(0, 200),
      damageType: dt,
      severity: sev,
      estimatedRepairCost: erc,
      photoUrl: typeof f.photoUrl === 'string' ? f.photoUrl.trim().slice(0, 500) : null,
      notes: typeof f.notes === 'string' ? f.notes.trim().slice(0, 5000) : null,
      isPreExisting: f.isPreExisting === true,
      disposition: disp,
    })
  }

  // Verify the bookingAssignment belongs to the order (defense in depth).
  const ba = await prisma.bookingAssignment.findUnique({
    where: { id: bookingAssignmentId },
    select: { bookingItem: { select: { booking: { select: { orders: { select: { id: true } } } } } } },
  })
  if (!ba || !ba.bookingItem.booking.orders.some((o) => o.id === params.id)) {
    return NextResponse.json({ error: 'bookingAssignment is not on this order' }, { status: 400 })
  }

  const result = await captureReturnDamage({
    bookingAssignmentId,
    overallCondition,
    mileageAtInspection,
    fuelLevel,
    inspectedById: user.id,
    findings,
  })
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
  }
  return NextResponse.json(result, { status: 201 })
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { bookingId: true },
  })
  if (!order) return NextResponse.json({ error: 'order not found' }, { status: 404 })

  const damages = order.bookingId
    ? await prisma.damageItem.findMany({
        where: {
          inspection: {
            type: 'RETURN',
            bookingAssignment: {
              bookingItem: { bookingId: order.bookingId },
            },
          },
        },
        select: {
          id: true,
          locationOnVehicle: true,
          damageType: true,
          severity: true,
          estimatedRepairCost: true,
          photoUrl: true,
          notes: true,
          isPreExisting: true,
          disposition: true,
          invoiceId: true,
          claimId: true,
          inspection: {
            select: {
              id: true,
              inspectionDate: true,
              asset: { select: { id: true, unitName: true } },
              bookingAssignment: { select: { id: true } },
            },
          },
        },
        orderBy: { inspection: { inspectionDate: 'desc' } },
      })
    : []

  // Also surface the order's available BookingAssignments so the UI
  // can build a "pick a vehicle" select.
  const assignments = order.bookingId
    ? await prisma.bookingAssignment.findMany({
        where: { bookingItem: { bookingId: order.bookingId } },
        select: {
          id: true,
          status: true,
          asset: { select: { id: true, unitName: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
    : []

  return NextResponse.json({ damages, assignments })
}
