/**
 * POST /api/incidents/[id]/bill-renter
 *
 * Routes an Incident into the existing L&D path (unchanged) by
 * creating DamageItem rows attached to the Incident. Once captured,
 * the rep generates the LD invoice via the EXISTING route at
 * POST /api/orders/[id]/ld-invoices — this endpoint does NOT
 * generate the invoice itself, by design. The spec is explicit:
 * connect to the existing L&D flow, don't move it.
 *
 * Required body:
 *   findings — array of damage entries (locationOnVehicle, damageType,
 *              severity, optional estimatedRepairCost, photoUrl, notes,
 *              isPreExisting).
 *
 * Requires the Incident to have an Order linked (LD invoice generation
 * keys on order.bookingId). Returns 409 with a clear message when the
 * Incident has no Order — UI should disable the button.
 *
 * DamageItem.disposition is set to BILL_NOW (rental invoice line) by
 * default. Caller can override per-finding (BILL_NOW | SEND_TO_LD |
 * WAIVED). DamageItem.inspectionId is the still-required FK, so we
 * also need an Inspection chain through the order's BookingAssignment.
 * If the order has no BookingAssignment, the endpoint returns 422
 * with a hint to capture a return inspection first — the existing
 * return-damage route at /api/orders/[id]/return-damage produces it.
 *
 * Auth: getServerSession.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { DamageDisposition, DamageSeverity, DamageType } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const VALID_TYPES: DamageType[] = ['SCRATCH', 'DENT', 'CRACK', 'MISSING_PART', 'MECHANICAL', 'INTERIOR', 'OTHER']
const VALID_SEVERITIES: DamageSeverity[] = ['MINOR', 'MODERATE', 'MAJOR']
const VALID_DISPOSITIONS: DamageDisposition[] = ['PENDING', 'BILL_NOW', 'SEND_TO_LD', 'WAIVED']
const TYPE_SET = new Set<string>(VALID_TYPES)
const SEVERITY_SET = new Set<string>(VALID_SEVERITIES)
const DISP_SET = new Set<string>(VALID_DISPOSITIONS)

interface FindingIn {
  locationOnVehicle?: unknown
  damageType?: unknown
  severity?: unknown
  estimatedRepairCost?: unknown
  photoUrl?: unknown
  notes?: unknown
  isPreExisting?: unknown
  disposition?: unknown
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: incidentId } = await params
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      id: true, status: true,
      orderId: true,
      order: {
        select: {
          id: true, orderNumber: true, bookingId: true,
          booking: {
            select: {
              id: true,
              items: {
                select: {
                  assignments: {
                    select: { id: true, inspections: { select: { id: true, type: true } } },
                    take: 1,
                  },
                },
                take: 1,
              },
            },
          },
        },
      },
    },
  })
  if (!incident) return NextResponse.json({ error: 'incident not found' }, { status: 404 })

  // ── Order gate ─────────────────────────────────────────────
  if (!incident.orderId || !incident.order) {
    return NextResponse.json(
      { error: 'incident has no Order linked — link an order before billing the renter' },
      { status: 409 },
    )
  }
  if (!incident.order.bookingId || !incident.order.booking) {
    return NextResponse.json(
      {
        error:
          'incident.order has no Booking chain — LD billing requires a Booking. ' +
          'Spine-only orders (created without a Booking) cannot bill renter via this path until that ' +
          'plumbing exists.',
      },
      { status: 422 },
    )
  }

  // Find an existing Inspection on this order's booking chain to
  // anchor DamageItem rows. DamageItem.inspectionId is REQUIRED on the
  // schema; without one we can't insert. Prefer a RETURN inspection;
  // fall back to any inspection on the assignment.
  let inspectionId: string | null = null
  const firstItem = incident.order.booking.items[0]
  const firstAssign = firstItem?.assignments[0]
  if (firstAssign) {
    const retIns = firstAssign.inspections.find((i) => i.type === 'RETURN')
    inspectionId = (retIns ?? firstAssign.inspections[0])?.id ?? null
  }
  if (!inspectionId) {
    return NextResponse.json(
      {
        error:
          'no Inspection on the order\'s booking chain — capture a return inspection via ' +
          '/api/orders/[id]/return-damage first, then re-run.',
      },
      { status: 422 },
    )
  }

  // ── Validate findings ──────────────────────────────────────
  const body = (await req.json().catch(() => ({}))) as { findings?: unknown }
  if (!Array.isArray(body.findings) || body.findings.length === 0) {
    return NextResponse.json({ error: 'findings[] required' }, { status: 400 })
  }
  const findings = body.findings as FindingIn[]
  const prepared: {
    locationOnVehicle: string
    damageType: DamageType
    severity: DamageSeverity
    estimatedRepairCost: number | null
    photoUrl: string | null
    notes: string | null
    isPreExisting: boolean
    disposition: DamageDisposition
  }[] = []
  for (const [idx, f] of findings.entries()) {
    if (typeof f.locationOnVehicle !== 'string' || f.locationOnVehicle.trim().length === 0) {
      return NextResponse.json({ error: `finding[${idx}].locationOnVehicle required` }, { status: 400 })
    }
    if (typeof f.damageType !== 'string' || !TYPE_SET.has(f.damageType)) {
      return NextResponse.json({ error: `finding[${idx}].damageType invalid` }, { status: 400 })
    }
    if (typeof f.severity !== 'string' || !SEVERITY_SET.has(f.severity)) {
      return NextResponse.json({ error: `finding[${idx}].severity invalid` }, { status: 400 })
    }
    let cost: number | null = null
    if (f.estimatedRepairCost != null) {
      const n = typeof f.estimatedRepairCost === 'number' ? f.estimatedRepairCost : Number(f.estimatedRepairCost)
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ error: `finding[${idx}].estimatedRepairCost must be ≥0` }, { status: 400 })
      }
      cost = n
    }
    const dispRaw = typeof f.disposition === 'string' ? f.disposition : 'BILL_NOW'
    const disposition = (DISP_SET.has(dispRaw) ? dispRaw : 'BILL_NOW') as DamageDisposition
    prepared.push({
      locationOnVehicle: f.locationOnVehicle.trim().slice(0, 300),
      damageType: f.damageType as DamageType,
      severity: f.severity as DamageSeverity,
      estimatedRepairCost: cost,
      photoUrl: typeof f.photoUrl === 'string' ? f.photoUrl.slice(0, 1000) : null,
      notes: typeof f.notes === 'string' ? f.notes.slice(0, 5000) : null,
      isPreExisting: f.isPreExisting === true,
      disposition,
    })
  }

  // ── Insert + advance Incident status ────────────────────────
  const created = await prisma.$transaction(async (tx) => {
    const damageRows = await Promise.all(
      prepared.map((p) =>
        tx.damageItem.create({
          data: {
            inspectionId: inspectionId!,
            incidentId,
            ...p,
          },
          select: { id: true, disposition: true },
        }),
      ),
    )
    // Forward-only status: OPEN/CLAIM_FILED → BILLED_RENTER.
    // RESOLVED + WRITTEN_OFF stay; CLAIM_FILED can move forward to
    // BILLED_RENTER (it represents BOTH postures together — claim
    // filed AND damages booked to renter; the UI shows both chips).
    if (incident.status === 'OPEN' || incident.status === 'CLAIM_FILED') {
      await tx.incident.update({
        where: { id: incidentId },
        data: { status: 'BILLED_RENTER' },
      })
    }
    return damageRows
  })

  return NextResponse.json(
    {
      ok: true,
      damageItems: created,
      nextStep:
        'Generate the LD invoice via POST /api/orders/' +
        incident.orderId +
        '/ld-invoices to bill the renter for SEND_TO_LD-disposition rows. ' +
        'BILL_NOW rows land on the next RENTAL invoice automatically.',
    },
    { status: 201 },
  )
}
