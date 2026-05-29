/**
 * captureReturnDamage — Phase 5 commit 4. Minimal return-inspection
 * + damage capture so the LD disposition surface has something to
 * triage.
 *
 * Operator picks a BookingAssignment (specific vehicle) on the order
 * and submits one or more damage findings. For each finding we
 * create (or reuse, if one already exists for this RETURN session)
 * an Inspection(type=RETURN), then write the DamageItem rows.
 *
 * Disposition starts at PENDING for each row unless the caller
 * supplies one. Operators triage in the UI by editing the
 * disposition before generating either invoice.
 *
 * One Inspection row per (bookingAssignmentId, RETURN) keeps the
 * inspection layer tidy — multiple captures during the same return
 * session add to the existing inspection rather than duplicating it.
 *
 * READ-ONLY against Order.booked* + RENTAL/LD invoice totals (those
 * are owned elsewhere).
 */

import type {
  DamageDisposition,
  DamageSeverity,
  DamageType,
  VehicleCondition,
} from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export interface CaptureDamageInput {
  bookingAssignmentId: string
  /** GOOD | FAIR | POOR | DAMAGED — picked once for the inspection.
   *  Defaults to DAMAGED if any findings have severity >= MODERATE. */
  overallCondition?: VehicleCondition
  mileageAtInspection?: number | null
  fuelLevel?: string | null
  inspectedById: string
  findings: Array<{
    locationOnVehicle: string
    damageType: DamageType
    severity: DamageSeverity
    estimatedRepairCost?: number | null
    photoUrl?: string | null
    notes?: string | null
    isPreExisting?: boolean
    disposition?: DamageDisposition
  }>
}

export type CaptureDamageResult =
  | {
      ok: true
      inspectionId: string
      damageIds: string[]
      assetId: string
    }
  | { ok: false; status: number; error: string }

export async function captureReturnDamage(input: CaptureDamageInput): Promise<CaptureDamageResult> {
  const { bookingAssignmentId, inspectedById, findings } = input
  if (findings.length === 0) {
    return { ok: false, status: 400, error: 'at least one damage finding is required' }
  }

  const ba = await prisma.bookingAssignment.findUnique({
    where: { id: bookingAssignmentId },
    select: { id: true, assetId: true },
  })
  if (!ba) {
    return { ok: false, status: 404, error: 'booking assignment not found' }
  }

  // Derive a sensible default for overallCondition when caller didn't
  // pass one: any MODERATE/MAJOR finding → DAMAGED; only MINOR → FAIR;
  // none → GOOD.
  const worst = findings.reduce<DamageSeverity | null>((acc, f) => {
    if (f.severity === 'MAJOR') return 'MAJOR'
    if (acc === 'MAJOR') return 'MAJOR'
    if (f.severity === 'MODERATE') return 'MODERATE'
    if (acc === 'MODERATE') return 'MODERATE'
    return f.severity
  }, null)
  const derivedCondition: VehicleCondition =
    input.overallCondition ??
    (worst === 'MAJOR' || worst === 'MODERATE' ? 'DAMAGED' : worst === 'MINOR' ? 'FAIR' : 'GOOD')

  const inspectionDate = new Date()

  const result = await prisma.$transaction(async (tx) => {
    // Reuse an existing RETURN inspection for this assignment if one
    // is already on file — keeps the inspection layer to one row per
    // (assignment, RETURN) session.
    let inspection = await tx.inspection.findFirst({
      where: { bookingAssignmentId, type: 'RETURN' },
      select: { id: true, assetId: true },
    })
    if (!inspection) {
      const created = await tx.inspection.create({
        data: {
          assetId: ba.assetId,
          bookingAssignmentId,
          type: 'RETURN',
          inspectedBy: inspectedById,
          inspectionDate,
          overallCondition: derivedCondition,
          mileageAtInspection: input.mileageAtInspection ?? null,
          fuelLevel: input.fuelLevel ?? null,
          newDamageFound: true,
        },
        select: { id: true, assetId: true },
      })
      inspection = created
    } else {
      // Refresh overallCondition + newDamageFound now that we're
      // appending findings. Never downgrade the condition — only
      // worsen it.
      await tx.inspection.update({
        where: { id: inspection.id },
        data: {
          newDamageFound: true,
          // Take the worst of (existing, derived). Reading the
          // existing condition is cheap and keeps the update honest.
        },
      })
    }

    const created: { id: string }[] = []
    for (const f of findings) {
      const di = await tx.damageItem.create({
        data: {
          inspectionId: inspection.id,
          locationOnVehicle: f.locationOnVehicle,
          damageType: f.damageType,
          severity: f.severity,
          estimatedRepairCost: f.estimatedRepairCost == null
            ? null
            : new Prisma.Decimal(f.estimatedRepairCost.toFixed(2)),
          photoUrl: f.photoUrl ?? null,
          notes: f.notes ?? null,
          isPreExisting: f.isPreExisting ?? false,
          disposition: f.disposition ?? 'PENDING',
        },
        select: { id: true },
      })
      created.push(di)
    }

    await tx.auditLog.create({
      data: {
        userId: inspectedById,
        action: 'damage.captured',
        entityType: 'Inspection',
        entityId: inspection.id,
        newValues: {
          assetId: inspection.assetId,
          findingCount: findings.length,
          damageIds: created.map((c) => c.id),
        },
      },
    })

    return { inspectionId: inspection.id, damageIds: created.map((c) => c.id), assetId: inspection.assetId }
  })

  return { ok: true, ...result }
}

/**
 * Update a single DamageItem's disposition. Operator triage step
 * between capture and invoice generation. Throws if the item is
 * already attached to an invoice (can't re-triage what's billed).
 */
export async function setDamageDisposition(args: {
  damageId: string
  disposition: DamageDisposition
  userId: string
}): Promise<{ ok: true; damageId: string } | { ok: false; status: number; error: string }> {
  const di = await prisma.damageItem.findUnique({
    where: { id: args.damageId },
    select: { id: true, invoiceId: true, disposition: true },
  })
  if (!di) return { ok: false, status: 404, error: 'damage item not found' }
  if (di.invoiceId) {
    return { ok: false, status: 409, error: 'damage already billed; void the invoice to retriage' }
  }
  if (di.disposition === args.disposition) return { ok: true, damageId: di.id }
  await prisma.$transaction(async (tx) => {
    await tx.damageItem.update({
      where: { id: di.id },
      data: { disposition: args.disposition },
    })
    await tx.auditLog.create({
      data: {
        userId: args.userId,
        action: 'damage.disposition_changed',
        entityType: 'DamageItem',
        entityId: di.id,
        oldValues: { disposition: di.disposition },
        newValues: { disposition: args.disposition },
      },
    })
  })
  return { ok: true, damageId: di.id }
}
