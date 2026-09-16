/**
 * Cargo 20–25 have no lift gate — the WORK (Wes, 2026-09-16).
 *
 * Two entry points, one implementation (the /admin/maintenance pattern):
 *
 *   laptop  scripts/cargo-vans-no-lift-gate.ts   — argv + journal file
 *   iPad    /admin/maintenance                   — same function, AuditLog row
 *
 * What it does, per unit in CARGO_NO_LIFT_GATE_UNITS (rules in cargoLiftGate.ts):
 *
 *   · re-files the original asset row from "Cargo Van w/ Liftgate" into
 *     "Cargo Van w/o Liftgate" — same row, same id, same history;
 *   · FOLDS any duplicate row (the "second Cargo 25") into the original:
 *     every history table that points at the duplicate is re-pointed at the
 *     survivor, facts the survivor lacks are copied over, and the duplicate
 *     is retired under a name that says what it is. Never deleted;
 *   · un-archives the w/o class if it was archived (it was, in June, when
 *     every van was filed under w/), and mirrors the w/ class's
 *     reservable-on-gantt flag onto it so the vans stay on the board;
 *   · sets both classes' unit counts (AssetCategory.totalUnits AND the
 *     merged InventoryItem.qtyOwned — the one the scheduler reads) to the
 *     number of active rows actually in them.
 *
 * What it deliberately does NOT do: re-class a HOLD. A reservation filed
 * under "w/ Liftgate" whose unit is one of these vans keeps its class and is
 * NAMED in the log — the class on a hold is what the quote says, and a
 * person changes that through the reservation, not a background write.
 *
 * Idempotent: a second run finds six active rows in w/o, nothing in w/,
 * counts already right, and writes nothing. Dry run by default.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { TaskRefused } from '@/lib/admin/taskRefused'
import { ACTIVE_ASSIGNMENT_STATUSES } from '@/lib/scheduling/availability'
import {
  CARGO_NO_LIFT_GATE_UNITS, cargoClassOf, planCargoMoves, foldedUnitName, fillFromDuplicate,
  ASSET_HISTORY_RELATIONS,
  type CargoAssetRow, type CargoUnitPlan, type CargoClass, type AssetHistoryRelation,
} from '@/lib/fleet/cargoLiftGate'

export interface MoveCargoOptions {
  /** Report what would happen and write NOTHING. */
  dryRun: boolean
  /** The HQ user pressing the button, for the per-asset audit rows. Null from the CLI. */
  actorUserId?: string | null
}

export interface FoldRecord {
  duplicateId: string
  duplicateWas: { unitName: string; categoryId: string; status: string; isActive: boolean }
  intoId: string
  /** Rows re-pointed, per history table. */
  moved: Record<AssetHistoryRelation, number>
  /** Facts copied onto the survivor because it lacked them. */
  filled: string[]
}

export interface MoveRecord {
  assetId: string
  unitName: string
  from: { categoryId: string; catalogItemId: string | null }
  to: { categoryId: string; catalogItemId: string | null }
}

export interface ClassCounts {
  categoryId: string
  name: string
  totalUnitsBefore: number
  qtyOwnedBefore: number | null
  after: number
}

export interface MoveCargoResult {
  dryRun: boolean
  plan: Array<{ unitName: string; action: CargoUnitPlan['action']; keepId: string | null; foldIds: string[]; inactiveIds: string[] }>
  moves: MoveRecord[]
  folds: FoldRecord[]
  /** Flags flipped on the w/o class so the vans are bookable there. */
  classFlags: string[]
  counts: ClassCounts[]
  /** Things a person should look at. Never blocks the run. */
  warnings: string[]
  /** Every asset id this run wrote to (or would). */
  touchedIds: string[]
  log: string[]
}

type CatRow = {
  id: string; name: string; slug: string; isActive: boolean; reservableOnGantt: boolean; totalUnits: number
}
type ItemRow = {
  id: string; code: string; description: string | null; qtyOwned: number; isActive: boolean; reservableOnGantt: boolean;
  legacyAssetCategoryId: string | null
}

const ASSET_FACTS_SELECT = {
  id: true, unitName: true, categoryId: true, catalogItemId: true, isActive: true, status: true, createdAt: true,
  notes: true, mileage: true,
  vin: true, licensePlate: true, year: true, make: true, model: true, accessCode: true,
  purchasePrice: true, currentValue: true, insurancePolicyNum: true, insuranceCardUrl: true,
  registrationUrl: true, registrationExpiresAt: true, bitCertificateUrl: true, bitCertificateExpiresAt: true,
  rentalworksAssetId: true, damageIdRef: true, equipmentTier: true,
  _count: {
    select: Object.fromEntries(ASSET_HISTORY_RELATIONS.map((r) => [r, true])) as Record<AssetHistoryRelation, true>,
  },
} satisfies Prisma.AssetSelect

type AssetFull = Prisma.AssetGetPayload<{ select: typeof ASSET_FACTS_SELECT }>

const historyTotal = (a: AssetFull) => ASSET_HISTORY_RELATIONS.reduce((n, r) => n + (a._count[r] ?? 0), 0)

/** One updateMany per history table, re-pointing a duplicate's rows at the survivor. */
async function repointHistory(tx: Prisma.TransactionClient, fromId: string, toId: string): Promise<Record<AssetHistoryRelation, number>> {
  const w = { where: { assetId: fromId }, data: { assetId: toId } }
  const [ba, cr, mr, dt, ins, ic, inc, lc, bi] = await Promise.all([
    tx.bookingAssignment.updateMany(w),
    tx.checkoutRecord.updateMany(w),
    tx.maintenanceRecord.updateMany(w),
    tx.dispatchTask.updateMany(w),
    tx.inspection.updateMany(w),
    tx.insuranceClaim.updateMany(w),
    tx.incident.updateMany(w),
    tx.lotCheck.updateMany(w),
    tx.bitInspection.updateMany(w),
  ])
  return {
    bookingAssignments: ba.count, checkoutRecords: cr.count, maintenanceRecords: mr.count, dispatchTasks: dt.count,
    inspections: ins.count, insuranceClaims: ic.count, incidents: inc.count, lotChecks: lc.count, bitInspections: bi.count,
  }
}

const appendNote = (existing: string | null, line: string) => {
  const cur = (existing ?? '').trim()
  return cur ? `${cur}\n${line}` : line
}

export async function moveCargoOffLiftGate(opts: MoveCargoOptions): Promise<MoveCargoResult> {
  const { dryRun } = opts
  const actorUserId = opts.actorUserId ?? null
  const now = new Date()
  const log: string[] = []
  const result: MoveCargoResult = {
    dryRun, plan: [], moves: [], folds: [], classFlags: [], counts: [], warnings: [], touchedIds: [], log,
  }
  const tag = dryRun ? '[dry run] ' : ''
  log.push(`${tag}Filing ${CARGO_NO_LIFT_GATE_UNITS.join(', ')} as cargo vans WITHOUT a lift gate…`)

  // ── The two classes. Both must exist, once each; the w/o one may be archived. ──
  const cats = await prisma.assetCategory.findMany({
    select: { id: true, name: true, slug: true, isActive: true, reservableOnGantt: true, totalUnits: true },
  })
  const byClass: Record<CargoClass, CatRow[]> = { WITH: [], WITHOUT: [] }
  for (const c of cats) {
    const cls = cargoClassOf(c.name)
    if (cls) byClass[cls].push(c)
  }
  for (const cls of ['WITH', 'WITHOUT'] as const) {
    const label = cls === 'WITH' ? 'w/ Liftgate' : 'w/o Liftgate'
    if (byClass[cls].length !== 1) {
      throw new TaskRefused(
        `Expected exactly one "Cargo Van ${label}" class, found ${byClass[cls].length}${byClass[cls].length ? `: ${byClass[cls].map((c) => `"${c.name}"`).join(', ')}` : ''}.`,
        byClass[cls].length === 0
          ? 'Create the class on /admin/asset-categories (or Fleet Pricing) first, named "Cargo Van w/o Liftgate", then run again.'
          : 'Rename or archive the extra class so only one carries that name, then run again.',
      )
    }
  }
  const withCat = byClass.WITH[0]
  const withoutCat = byClass.WITHOUT[0]
  log.push(`✓ classes: "${withCat.name}" (${withCat.id.slice(0, 8)}) → "${withoutCat.name}" (${withoutCat.id.slice(0, 8)}${withoutCat.isActive ? '' : ', ARCHIVED'})`)

  // The merged catalog rows — the scheduler lists a class by its merged row's
  // qtyOwned, and a class with no merged row cannot be reserved at all.
  const items = await prisma.inventoryItem.findMany({
    where: { legacyAssetCategoryId: { in: [withCat.id, withoutCat.id] } },
    select: { id: true, code: true, description: true, qtyOwned: true, isActive: true, reservableOnGantt: true, legacyAssetCategoryId: true },
  })
  const withItem: ItemRow | null = items.find((i) => i.legacyAssetCategoryId === withCat.id) ?? null
  const withoutItem: ItemRow | null = items.find((i) => i.legacyAssetCategoryId === withoutCat.id) ?? null
  if (!withoutItem) {
    throw new TaskRefused(
      `"${withoutCat.name}" has no merged catalog row (InventoryItem.legacyAssetCategoryId), so nothing could reserve a van filed there.`,
      'Every fleet class was given one in the Aug 2026 catalog merge; this one is missing. Restore or re-create it on /inventory before moving the vans.',
    )
  }
  log.push(`✓ catalog rows: ${withItem ? withItem.code : '(none for w/)'} · ${withoutItem.code}${withoutItem.isActive ? '' : ' (ARCHIVED)'}`)

  // ── Every row carrying one of the six names, in either class. ──
  const assets = await prisma.asset.findMany({
    where: { unitName: { in: [...CARGO_NO_LIFT_GATE_UNITS] }, categoryId: { in: [withCat.id, withoutCat.id] } },
    select: ASSET_FACTS_SELECT,
    orderBy: [{ unitName: 'asc' }, { createdAt: 'asc' }],
  })
  const byId = new Map(assets.map((a) => [a.id, a]))
  const rows: CargoAssetRow[] = assets.map((a) => ({
    id: a.id, unitName: a.unitName, cls: a.categoryId === withCat.id ? 'WITH' : 'WITHOUT', isActive: a.isActive, createdAt: a.createdAt,
  }))
  const strays = await prisma.asset.findMany({
    where: { unitName: { in: [...CARGO_NO_LIFT_GATE_UNITS] }, categoryId: { notIn: [withCat.id, withoutCat.id] } },
    select: { id: true, unitName: true, isActive: true, category: { select: { name: true } } },
  })
  for (const s of strays) {
    result.warnings.push(`"${s.unitName}" also exists in "${s.category.name}" (${s.id}${s.isActive ? '' : ', inactive'}) — not a cargo class, left alone.`)
  }

  const plans = planCargoMoves(rows)
  for (const p of plans) {
    result.plan.push({
      unitName: p.unitName, action: p.action, keepId: p.keep?.id ?? null,
      foldIds: p.fold.map((f) => f.id), inactiveIds: p.inactive.map((i) => i.id),
    })
    const desc = (r: CargoAssetRow) => {
      const a = byId.get(r.id)!
      return `${r.id.slice(0, 12)}… in ${r.cls === 'WITH' ? 'w/' : 'w/o'}, ${historyTotal(a)} history rows, since ${r.createdAt.toISOString().slice(0, 10)}`
    }
    switch (p.action) {
      case 'move':
        log.push(`• ${p.unitName}: move (${desc(p.keep!)})`)
        break
      case 'merge-and-move':
        log.push(`• ${p.unitName}: fold ${p.fold.length} duplicate${p.fold.length === 1 ? '' : 's'} into the original, then move (keep ${desc(p.keep!)})`)
        for (const f of p.fold) log.push(`    ↳ fold ${desc(f)}`)
        break
      case 'merge':
        log.push(`• ${p.unitName}: already in w/o but ${p.fold.length + 1} active rows — fold into the oldest (keep ${desc(p.keep!)})`)
        for (const f of p.fold) log.push(`    ↳ fold ${desc(f)}`)
        break
      case 'in-place':
        log.push(`• ${p.unitName}: already one active row in w/o — nothing to do`)
        break
      case 'missing':
        log.push(`• ${p.unitName}: NO active row in either class — nothing invented`)
        result.warnings.push(`${p.unitName} has no active row in either cargo class; add it on the Fleet page if the van is real.`)
        break
    }
    for (const i of p.inactive) log.push(`    · inactive row left alone: ${desc(i)}`)
  }

  // Assignment collisions: the same hold assigned BOTH rows of one van would
  // become two assignments of one unit after the fold. Not blocked — the desk
  // releases one from the reservation — but it has to be said.
  for (const p of plans) {
    if (!p.keep || p.fold.length === 0) continue
    const keepItems = await prisma.bookingAssignment.findMany({
      where: { assetId: p.keep.id }, select: { bookingItemId: true },
    })
    const keepSet = new Set(keepItems.map((k) => k.bookingItemId))
    for (const f of p.fold) {
      const clash = await prisma.bookingAssignment.findMany({
        where: { assetId: f.id, bookingItemId: { in: [...keepSet] } },
        select: { id: true, bookingItem: { select: { booking: { select: { bookingNumber: true } } } } },
      })
      for (const c of clash) {
        result.warnings.push(`${p.unitName}: reservation ${c.bookingItem.booking.bookingNumber} was assigned both rows — after the fold it holds the unit twice; release one assignment (${c.id}).`)
      }
    }
  }

  // Holds that will be filed under w/ while their unit sits in w/o. Named,
  // never re-classed here.
  const touchedAssetIds = plans.flatMap((p) => [...(p.keep ? [p.keep.id] : []), ...p.fold.map((f) => f.id)])
  if (touchedAssetIds.length) {
    const crossClass = await prisma.bookingAssignment.findMany({
      where: {
        assetId: { in: touchedAssetIds },
        status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
        endDate: { gte: now },
        bookingItem: { categoryId: withCat.id },
      },
      select: {
        asset: { select: { unitName: true } }, startDate: true, endDate: true,
        bookingItem: { select: { booking: { select: { bookingNumber: true, jobName: true } } } },
      },
      orderBy: { startDate: 'asc' },
    })
    for (const x of crossClass) {
      const b = x.bookingItem.booking
      result.warnings.push(
        `${x.asset.unitName} on ${b.bookingNumber}${b.jobName ? ` (${b.jobName})` : ''} ${x.startDate.toISOString().slice(0, 10)}→${x.endDate.toISOString().slice(0, 10)} is filed under "${withCat.name}" — re-class the hold on the reservation if the quote should say w/o.`,
      )
    }
  }

  // ── What the classes end up holding. ──
  const [withActiveNow, withoutActiveNow] = await Promise.all([
    prisma.asset.count({ where: { categoryId: withCat.id, isActive: true } }),
    prisma.asset.count({ where: { categoryId: withoutCat.id, isActive: true } }),
  ])
  const movingOut = plans.filter((p) => p.action === 'move' || p.action === 'merge-and-move').length
  const foldingInWith = plans.flatMap((p) => p.fold).filter((f) => f.cls === 'WITH').length
  const foldingInWithout = plans.flatMap((p) => p.fold).filter((f) => f.cls === 'WITHOUT').length
  const withAfter = withActiveNow - movingOut - foldingInWith
  const withoutAfter = withoutActiveNow + movingOut - foldingInWithout
  result.counts = [
    { categoryId: withCat.id, name: withCat.name, totalUnitsBefore: withCat.totalUnits, qtyOwnedBefore: withItem?.qtyOwned ?? null, after: withAfter },
    { categoryId: withoutCat.id, name: withoutCat.name, totalUnitsBefore: withoutCat.totalUnits, qtyOwnedBefore: withoutItem.qtyOwned, after: withoutAfter },
  ]
  for (const c of result.counts) {
    log.push(`counts · "${c.name}": ${c.totalUnitsBefore}/${c.qtyOwnedBefore ?? '—'} (class/catalog) → ${c.after} active units`)
  }

  const flags: string[] = []
  if (!withoutCat.isActive) flags.push(`un-archive "${withoutCat.name}" (class)`)
  if (!withoutItem.isActive) flags.push(`un-archive ${withoutItem.code} (catalog row)`)
  if (withCat.reservableOnGantt && !withoutCat.reservableOnGantt) flags.push(`reservable on the board (class)`)
  if ((withItem?.reservableOnGantt ?? false) && !withoutItem.reservableOnGantt) flags.push(`reservable on the board (catalog row)`)
  result.classFlags = flags
  for (const f of flags) log.push(`flag · ${f}`)

  const nothingToDo = plans.every((p) => p.action === 'in-place' || p.action === 'missing')
    && flags.length === 0
    && withAfter === withCat.totalUnits && (withItem === null || withAfter === withItem.qtyOwned)
    && withoutAfter === withoutCat.totalUnits && withoutAfter === withoutItem.qtyOwned
  if (nothingToDo) {
    log.push('Nothing to write — already filed this way.')
    return result
  }

  result.touchedIds = touchedAssetIds
  if (dryRun) {
    log.push('Dry run — nothing written.')
    return result
  }

  // ── Write. One transaction: a half-folded van is worse than an unfolded one. ──
  await prisma.$transaction(async (tx) => {
    for (const p of plans) {
      if (!p.keep) continue
      const keep = byId.get(p.keep.id)!

      for (const f of p.fold) {
        const dup = byId.get(f.id)!
        const moved = await repointHistory(tx, dup.id, keep.id)
        const fill = fillFromDuplicate(keep, dup)
        if (Object.keys(fill).length) {
          await tx.asset.update({ where: { id: keep.id }, data: fill as Prisma.AssetUncheckedUpdateInput })
        }
        const movedLine = ASSET_HISTORY_RELATIONS.filter((r) => moved[r] > 0).map((r) => `${moved[r]} ${r}`).join(', ') || 'no history'
        await tx.asset.update({
          where: { id: dup.id },
          data: {
            unitName: foldedUnitName(dup.unitName, now),
            status: 'RETIRED',
            isActive: false,
            notes: appendNote(dup.notes, `Duplicate of ${keep.unitName} (${keep.id}); folded in by the cargo lift-gate task ${now.toISOString().slice(0, 10)}. Moved there: ${movedLine}.`),
          },
        })
        await tx.auditLog.create({
          data: {
            userId: actorUserId,
            action: 'asset.folded_into',
            entityType: 'Asset',
            entityId: dup.id,
            oldValues: { unitName: dup.unitName, categoryId: dup.categoryId, status: dup.status, isActive: dup.isActive },
            newValues: { intoAssetId: keep.id, intoUnitName: keep.unitName, moved, filled: Object.keys(fill), task: 'cargo-vans-no-lift-gate' },
          },
        })
        result.folds.push({
          duplicateId: dup.id,
          duplicateWas: { unitName: dup.unitName, categoryId: dup.categoryId, status: dup.status, isActive: dup.isActive },
          intoId: keep.id, moved, filled: Object.keys(fill),
        })
        log.push(`✓ ${p.unitName}: folded ${dup.id.slice(0, 12)}… into ${keep.id.slice(0, 12)}… (${movedLine}${Object.keys(fill).length ? `; filled ${Object.keys(fill).join(', ')}` : ''})`)
      }

      if (p.action === 'move' || p.action === 'merge-and-move') {
        const to = { categoryId: withoutCat.id, catalogItemId: withoutItem.id }
        await tx.asset.update({ where: { id: keep.id }, data: to })
        await tx.auditLog.create({
          data: {
            userId: actorUserId,
            action: 'asset.category_moved',
            entityType: 'Asset',
            entityId: keep.id,
            oldValues: { categoryId: keep.categoryId, catalogItemId: keep.catalogItemId, categoryName: withCat.name },
            newValues: { ...to, categoryName: withoutCat.name, task: 'cargo-vans-no-lift-gate' },
          },
        })
        result.moves.push({ assetId: keep.id, unitName: keep.unitName, from: { categoryId: keep.categoryId, catalogItemId: keep.catalogItemId }, to })
        log.push(`✓ ${p.unitName}: moved to "${withoutCat.name}"`)
      }
    }

    // The class the vans now sit in has to be one the pickers list.
    if (!withoutCat.isActive || (withCat.reservableOnGantt && !withoutCat.reservableOnGantt)) {
      await tx.assetCategory.update({
        where: { id: withoutCat.id },
        data: {
          ...(!withoutCat.isActive ? { isActive: true, archivedAt: null } : {}),
          ...(withCat.reservableOnGantt && !withoutCat.reservableOnGantt ? { reservableOnGantt: true } : {}),
        },
      })
    }
    if (!withoutItem.isActive || ((withItem?.reservableOnGantt ?? false) && !withoutItem.reservableOnGantt)) {
      await tx.inventoryItem.update({
        where: { id: withoutItem.id },
        data: {
          ...(!withoutItem.isActive ? { isActive: true, archivedAt: null } : {}),
          ...((withItem?.reservableOnGantt ?? false) && !withoutItem.reservableOnGantt ? { reservableOnGantt: true } : {}),
        },
      })
    }
    for (const f of flags) log.push(`✓ ${f}`)

    // Counts from the rows themselves, now that they have moved.
    const [withNow, withoutNow] = await Promise.all([
      tx.asset.count({ where: { categoryId: withCat.id, isActive: true } }),
      tx.asset.count({ where: { categoryId: withoutCat.id, isActive: true } }),
    ])
    await tx.assetCategory.update({ where: { id: withCat.id }, data: { totalUnits: withNow } })
    await tx.assetCategory.update({ where: { id: withoutCat.id }, data: { totalUnits: withoutNow } })
    if (withItem) await tx.inventoryItem.update({ where: { id: withItem.id }, data: { qtyOwned: withNow } })
    await tx.inventoryItem.update({ where: { id: withoutItem.id }, data: { qtyOwned: withoutNow } })
    result.counts[0].after = withNow
    result.counts[1].after = withoutNow
    log.push(`✓ counts: "${withCat.name}" ${withNow} · "${withoutCat.name}" ${withoutNow}`)
  }, { timeout: 60_000 })

  return result
}
