/**
 * Sprint 2B — attach the driver at physical pickup.
 *
 * The CHECKOUT inspection (Sprint 2A) creates the CheckoutRecord with
 * driverId null, because the pre-rental walkaround happens before anyone
 * knows who the production is actually sending. This is the other half:
 * the person turns up, and the vehicle is handed over.
 *
 * That handover is THE gate. A driver cannot be attached unless a licence
 * is on file, unexpired, and checked by a human — see licenseGate.ts.
 *
 * Override: staff can push through with a written reason. A hard block
 * with no escape hatch doesn't hold the line, it just teaches people to
 * mark licences "checked" without looking, which is strictly worse than
 * an override that leaves a record. The reason is required, stored on the
 * checkout, and the gate failure is recorded rather than erased.
 */

import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVehicleHandoverAccess } from '@/lib/fleet/requireVehicleHandoverAccess'
import { evaluateLicenseGate } from '@/lib/drivers/licenseGate'

export const dynamic = 'force-dynamic'

const DRIVER_LICENSE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  licenseFrontUrl: true,
  licenseBackUrl: true,
  licenseExpiry: true,
  licenseExpired: true,
  licenseVerified: true,
} as const

/** GET — can this checkout be handed over, and to whom? Lets the UI show
 *  the blocker BEFORE someone tries, instead of failing on submit. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVehicleHandoverAccess()
  if (!auth.ok) return auth.response
  const { id } = await params
  const rec = await prisma.checkoutRecord.findUnique({
    where: { id },
    select: {
      id: true, driverId: true, licenseVerified: true, returnTime: true,
      driver: { select: DRIVER_LICENSE_SELECT },
    },
  })
  if (!rec) return NextResponse.json({ error: 'checkout not found' }, { status: 404 })
  const gate = evaluateLicenseGate(rec.driver)
  return NextResponse.json({
    ok: true,
    checkoutId: rec.id,
    driverId: rec.driverId,
    driverName: rec.driver ? `${rec.driver.firstName} ${rec.driver.lastName}`.trim() : null,
    licenseVerified: rec.licenseVerified,
    gate,
  })
}

/**
 * POST — attach a driver. Body:
 *   { driverId: string, overrideReason?: string }
 *
 * 409 with { gate } when the licence fails and no reason was supplied.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireVehicleHandoverAccess()
  if (!auth.ok) return auth.response
  const { id } = await params
  const body = (await req.json().catch(() => null)) as {
    driverId?: string
    overrideReason?: string
  } | null

  const driverId = typeof body?.driverId === 'string' ? body.driverId.trim() : ''
  if (!driverId) {
    return NextResponse.json({ error: 'driverId is required' }, { status: 400 })
  }

  const rec = await prisma.checkoutRecord.findUnique({
    where: { id },
    select: { id: true, returnTime: true, notes: true, bookingAssignmentId: true },
  })
  if (!rec) return NextResponse.json({ error: 'checkout not found' }, { status: 404 })
  if (rec.returnTime) {
    return NextResponse.json(
      { error: 'This vehicle has already been returned — the checkout is closed.' },
      { status: 409 },
    )
  }

  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: DRIVER_LICENSE_SELECT,
  })
  if (!driver) return NextResponse.json({ error: 'driver not found' }, { status: 400 })

  const gate = evaluateLicenseGate(driver)
  const reason = typeof body?.overrideReason === 'string' ? body.overrideReason.trim() : ''

  if (!gate.ok && !reason) {
    // The blocker, not just "denied" — the rep needs to know what to fix.
    return NextResponse.json(
      { error: gate.message, gate, canOverride: true, requires: 'overrideReason' },
      { status: 409 },
    )
  }

  const overridden = !gate.ok && !!reason
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const overrideNote = overridden
    ? `[${stamp}] LICENSE GATE OVERRIDDEN (${gate.code}) by ${auth.name ?? auth.userId}: ${reason.slice(0, 500)}`
    : null

  const updated = await prisma.checkoutRecord.update({
    where: { id },
    data: {
      driverId,
      // Records that the licence was good at handover — NOT copied from
      // the driver row later, so a licence expiring mid-rental doesn't
      // rewrite what was true when the keys changed hands.
      licenseVerified: gate.ok,
      notes: overrideNote ? [rec.notes, overrideNote].filter(Boolean).join('\n') : rec.notes,
    },
    select: { id: true, driverId: true, licenseVerified: true },
  })

  // Record the handover on the JOB's driver list too, so the plan and what
  // actually happened stop disagreeing. Before this, a driver added at the
  // counter existed only on the CheckoutRecord: the job page, the client's
  // portal and the board all still read "no driver named" for a vehicle
  // that had already left the yard.
  //
  // This is also the only writer of PICKED_UP. Both DELETE endpoints carve
  // that status out — "those keys are already gone" — and until now the
  // carve-out was dead code, so a client could cancel a driver who was
  // holding the truck. Upsert, because the usual case is the driver the
  // client named weeks ago finally turning up: same row, advanced, not a
  // duplicate.
  let jobRecorded = false
  try {
    await prisma.driverAssignment.upsert({
      where: {
        driverId_bookingAssignmentId: {
          driverId,
          bookingAssignmentId: rec.bookingAssignmentId,
        },
      },
      update: { status: 'PICKED_UP' },
      create: {
        driverId,
        bookingAssignmentId: rec.bookingAssignmentId,
        status: 'PICKED_UP',
        // A walk-up driver gets a live token like any other: they still
        // need the gate code to get out and the drop-off instructions to
        // come back. Not emailed — they're standing here.
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
        invitedBySource: 'STAFF',
        invitedByUserId: auth.userId ?? null,
        emailSentTo: null,
      },
    })
    jobRecorded = true
  } catch (e) {
    // Never fail a handover over the bookkeeping — the keys have moved and
    // the CheckoutRecord above is the authoritative record of that.
    console.error('[fleet/checkout/driver] driverAssignment upsert failed', e)
  }

  return NextResponse.json({
    ok: true,
    checkout: updated,
    gate,
    overridden,
    jobRecorded,
    driverName: `${driver.firstName} ${driver.lastName}`.trim(),
  })
}
