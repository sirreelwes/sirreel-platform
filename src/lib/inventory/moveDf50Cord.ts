/**
 * The DF-50's power cord onto the machine — the WORK, with two entry points.
 *
 *   iPad    /admin/maintenance → "DF-50: the power cord belongs to the machine"
 *   laptop  npx tsx scripts/move-df50-cord.ts [--write]
 *
 * Wes 2026-09-17: "The IEC POWER CORD EDISON is attached to the DF50 Hazer
 * Fluid 1 Gallon. It should be attached to the DF50 Hazer."
 *
 * The rule half is pure, in df50Cord.ts. One implementation, two doors (see
 * seedVsmPlanet.ts for why). Idempotent: run it twice and the second run
 * changes nothing.
 *
 * A MISPLACED LINK IS DEACTIVATED, NEVER DELETED. InventoryKitPiece rows
 * carry the order lines they generated (`orderLines`), so deleting one — or
 * re-pointing its parent — rewrites what past orders say went out. The old
 * link goes isActive:false, the right one is created beside it, and both ids
 * are in the result so the move can be undone by id.
 *
 * The cord's own terms travel with it: whatever ratio, billing and
 * visibility it had on the fluid it keeps on the machine. The terms were
 * not the thing that was wrong — the parent was.
 */

import { prisma } from '@/lib/prisma'
import { TaskRefused } from '@/lib/admin/taskRefused'
import { DF50_HAZER_CODES, isDf50MachineRow } from '@/lib/inventory/df50Fluid'
import { chooseIecCord, cordIsMisplaced } from '@/lib/inventory/df50Cord'

export interface MoveDf50CordOptions {
  dryRun: boolean
}

export interface MoveDf50CordResult {
  dryRun: boolean
  log: string[]
  /** Kit links created this run (the cord on a machine). */
  createdIds: string[]
  /** Kit links deactivated, and any link revived. */
  touchedIds: string[]
  /** Things a person should look at. */
  warnings: string[]
  /** Misplaced links taken down. */
  movedOff: number
  /** Machine rows that now carry the cord. */
  linked: number
}

type Row = {
  id: string
  code: string
  description: string | null
  isActive: boolean
}

const name = (r: { code: string; description: string | null }) => `${r.code} "${r.description ?? ''}"`

export async function moveDf50Cord(opts: MoveDf50CordOptions): Promise<MoveDf50CordResult> {
  const { dryRun } = opts
  const log: string[] = []
  const result: MoveDf50CordResult = {
    dryRun, log, createdIds: [], touchedIds: [], warnings: [], movedOff: 0, linked: 0,
  }
  const tag = dryRun ? '[dry run] ' : ''
  log.push(`${tag}DF-50: the IEC power cord belongs to the machine, not to its fluid…`)

  // ── The machines ──────────────────────────────────────────────────────
  const machines = (await prisma.inventoryItem.findMany({
    where: { code: { in: [...DF50_HAZER_CODES] } },
    select: { id: true, code: true, description: true, isActive: true },
  })) as Row[]
  const live = machines.filter((m) => m.isActive)
  if (live.length === 0) {
    throw new TaskRefused(
      `None of the DF-50 machine rows (${DF50_HAZER_CODES.join(', ')}) is active.`,
      'Nothing to attach a cord to. If the DF-50 was re-coded, update DF50_HAZER_CODES in df50Fluid.ts.',
    )
  }
  const notMachines = live.filter((m) => !isDf50MachineRow(m))
  if (notMachines.length) {
    throw new TaskRefused(
      `These codes do not read as a DF-50 machine: ${notMachines.map(name).join(', ')}.`,
      'Hanging a power cord off a row that is not a machine is the bug this task exists to fix, so it refuses rather than repeat it. Check the rows on /inventory.',
    )
  }
  for (const m of machines) log.push(`${m.isActive ? '✓' : '·'} machine ${name(m)}${m.isActive ? '' : ' — inactive, skipped'}`)

  // ── The cord ──────────────────────────────────────────────────────────
  const candidates = (await prisma.inventoryItem.findMany({
    where: { isActive: true, OR: [{ code: { contains: 'iec', mode: 'insensitive' } }, { description: { contains: 'iec', mode: 'insensitive' } }] },
    select: { id: true, code: true, description: true, isActive: true },
  })) as Row[]
  const choice = chooseIecCord(candidates)
  if (!choice.cord) {
    throw new TaskRefused(
      `No cord to move: ${choice.reason}.`,
      'Find the IEC power cord on /inventory and make sure exactly one active row is named as one, then run this again.',
    )
  }
  const cord = choice.cord
  log.push(`✓ cord ${name(cord)} (${choice.reason})`)

  // ── Where it hangs today ──────────────────────────────────────────────
  const links = await prisma.inventoryKitPiece.findMany({
    where: { pieceItemId: cord.id },
    select: {
      id: true, parentItemId: true, isActive: true,
      qtyPer: true, perUnits: true, rounding: true, minQty: true, billing: true,
      clientVisible: true, suppressIfOrdered: true, note: true, sortOrder: true,
      parent: { select: { id: true, code: true, description: true } },
      _count: { select: { orderLines: true } },
    },
  })
  const active = links.filter((l) => l.isActive)
  const misplaced = active.filter((l) => cordIsMisplaced(l.parent, DF50_HAZER_CODES))
  const onMachine = new Set(active.filter((l) => !cordIsMisplaced(l.parent, DF50_HAZER_CODES)).map((l) => l.parentItemId))

  if (!active.length) log.push('· the cord is attached to nothing today')
  for (const l of active) {
    const where = cordIsMisplaced(l.parent, DF50_HAZER_CODES) ? 'WRONG — not a DF-50 machine' : 'already on a machine'
    log.push(`  attached to ${name(l.parent)} — ${where}${l._count.orderLines ? ` (${l._count.orderLines} order line(s) came from this link)` : ''}`)
  }

  // The terms to carry across: whatever the misplaced link already used,
  // else the plain one-per-machine default. The parent was the bug.
  const donor = misplaced[0]
  const settings = {
    qtyPer: donor?.qtyPer ?? 1,
    perUnits: donor?.perUnits ?? 1,
    rounding: donor?.rounding ?? ('CEIL' as const),
    minQty: donor?.minQty ?? 0,
    billing: donor?.billing ?? ('FREE' as const),
    clientVisible: donor?.clientVisible ?? false,
    suppressIfOrdered: donor?.suppressIfOrdered ?? true,
    note: donor?.note ?? null,
    sortOrder: donor?.sortOrder ?? 0,
    isActive: true,
  }

  // ── Put it on every machine ───────────────────────────────────────────
  for (const m of live) {
    if (onMachine.has(m.id)) {
      log.push(`· ${m.code} already carries the cord`)
      continue
    }
    result.linked++
    log.push(`${dryRun ? '→' : '✓'} ${name(m)} → ${cord.code}: ${settings.qtyPer} per ${settings.perUnits}, ${settings.billing}`)
    if (dryRun) continue
    const existing = await prisma.inventoryKitPiece.findUnique({
      where: { parentItemId_pieceItemId: { parentItemId: m.id, pieceItemId: cord.id } },
      select: { id: true },
    })
    if (existing) {
      // An inactive link from an earlier attempt — revive it rather than
      // trip the (parent, piece) unique key.
      await prisma.inventoryKitPiece.update({ where: { id: existing.id }, data: settings })
      result.touchedIds.push(existing.id)
    } else {
      const created = await prisma.inventoryKitPiece.create({
        data: { parentItemId: m.id, pieceItemId: cord.id, ...settings },
        select: { id: true },
      })
      result.createdIds.push(created.id)
    }
  }

  // ── Take it off everything that is not a machine ──────────────────────
  for (const l of misplaced) {
    result.movedOff++
    log.push(`${dryRun ? '→' : '✓'} take the cord off ${name(l.parent)} (deactivated, not deleted — its order history stays readable)`)
    if (dryRun) continue
    await prisma.inventoryKitPiece.update({ where: { id: l.id }, data: { isActive: false } })
    await prisma.auditLog.create({
      data: {
        userId: null,
        action: 'inventory.kit_piece_moved',
        entityType: 'InventoryKitPiece',
        entityId: l.id,
        oldValues: { parentCode: l.parent.code, isActive: true },
        newValues: {
          isActive: false,
          reason: 'the IEC power cord belongs to the DF-50 machine, not to its fluid',
          task: 'df50-cord-to-machine',
        },
      },
    })
    result.touchedIds.push(l.id)
  }

  if (!misplaced.length && result.linked === 0) {
    log.push('Already filed this way — nothing to change.')
  } else if (dryRun) {
    log.push('Dry run — nothing written.')
  } else {
    log.push('Done. A DF-50 added to an order from now on brings its cord; orders already quoted are not touched.')
  }
  if (misplaced.length && !live.length) {
    result.warnings.push('The cord came off a non-machine row but no active machine took it — check /inventory.')
  }
  return result
}
