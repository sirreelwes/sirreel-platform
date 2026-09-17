/**
 * DF-50 hazer → fluid, as a kit — the WORK, with two entry points.
 *
 *   iPad    /admin/maintenance → "DF-50 hazer: fluid goes out with it"
 *   laptop  npx tsx scripts/seed-df50-fluid-kit.ts [--write]
 *
 * One implementation (see seedVsmPlanet.ts for why). Idempotent: an
 * existing kit link for the same machine + fluid is brought to these
 * settings, never duplicated. The rule for which row is the fluid and which
 * fluid goes on which machine is pure, in df50Fluid.ts.
 *
 * The settings are the Rosco fluid settings of 2026-09-15, deliberately:
 * one bottle per machine, CHARGED (Wes: "charge for fluid — it has a price
 * in expendables"), printed on the quote (a charge the client cannot see is
 * a charge they will dispute), and suppressIfOrdered so a client who lists
 * fluid themselves keeps their line and is not billed a second jug.
 *
 * THE FLUID MUST BILL AS AN EXPENDABLE — qty × rate, once. Under
 * PRO_SUPPLIES it would bill rate × days, so a jug on a three-day rental
 * would charge three jugs. The Roscos hit exactly this; the row is moved to
 * EXPENDABLES / EXPENDABLE here if it is not there already.
 */

import { prisma } from '@/lib/prisma'
import { TaskRefused } from '@/lib/admin/taskRefused'
import { DF50_HAZER_CODES, isDf50FluidRow, isDf50MachineRow, pairFluidsToMachines } from '@/lib/inventory/df50Fluid'

export const DF50_FLUID_PIECE_SETTINGS = {
  qtyPer: 1,
  perUnits: 1,
  rounding: 'CEIL' as const,
  minQty: 0,
  billing: 'CHARGED' as const,
  clientVisible: true,
  suppressIfOrdered: true,
  isActive: true,
}

export interface SeedDf50Options {
  dryRun: boolean
}

export interface SeedDf50Result {
  dryRun: boolean
  log: string[]
  /** Kit links created this run. */
  createdIds: string[]
  /** Kit links updated and fluid rows re-departmented. */
  touchedIds: string[]
  /** Things a person should look at — the fluid has no price, say. */
  warnings: string[]
  /** How many machine rows got (or would get) a link. */
  linked: number
}

type Row = {
  id: string
  code: string
  description: string | null
  department: string
  type: string
  dailyRate: unknown
  isActive: boolean
}

const name = (r: Row) => `${r.code} "${r.description ?? ''}"`

export async function seedDf50FluidKit(opts: SeedDf50Options): Promise<SeedDf50Result> {
  const { dryRun } = opts
  const log: string[] = []
  const result: SeedDf50Result = { dryRun, log, createdIds: [], touchedIds: [], warnings: [], linked: 0 }
  const tag = dryRun ? '[dry run] ' : ''
  log.push(`${tag}DF-50 hazer: fluid goes out with every machine, as a charged kit piece…`)

  // ── The machines: the three rows the pick-list check names ────────────
  const machines = (await prisma.inventoryItem.findMany({
    where: { code: { in: [...DF50_HAZER_CODES] } },
    select: { id: true, code: true, description: true, department: true, type: true, dailyRate: true, isActive: true },
  })) as Row[]
  const live = machines.filter((m) => m.isActive)
  const notMachines = live.filter((m) => !isDf50MachineRow(m))
  if (notMachines.length) {
    throw new TaskRefused(
      `These codes do not read as a DF-50 machine: ${notMachines.map(name).join(', ')}.`,
      'Check the rows on /inventory — the code list in df50Fluid.ts names the DF-50 machines and one of them now points at something else.',
    )
  }
  if (live.length === 0) {
    throw new TaskRefused(
      `None of the DF-50 machine rows (${DF50_HAZER_CODES.join(', ')}) is active.`,
      'Nothing to attach a fluid to. If the DF-50 was re-coded, update DF50_HAZER_CODES in df50Fluid.ts.',
    )
  }
  for (const m of machines) log.push(`${m.isActive ? '✓' : '·'} machine ${name(m)}${m.isActive ? '' : ' — inactive, skipped'}`)

  // ── The fluid: found by name, refused when ambiguous ──────────────────
  const candidates = (await prisma.inventoryItem.findMany({
    where: {
      isActive: true,
      OR: [
        { description: { contains: 'df50', mode: 'insensitive' } },
        { description: { contains: 'df-50', mode: 'insensitive' } },
        { description: { contains: 'df 50', mode: 'insensitive' } },
        { code: { contains: 'df50', mode: 'insensitive' } },
        { code: { contains: 'df-50', mode: 'insensitive' } },
      ],
    },
    select: { id: true, code: true, description: true, department: true, type: true, dailyRate: true, isActive: true },
  })) as Row[]
  const fluids = candidates.filter(isDf50FluidRow)
  if (fluids.length === 0) {
    throw new TaskRefused(
      `No active catalog row reads as DF-50 fluid (looked at ${candidates.length} DF-50 row${candidates.length === 1 ? '' : 's'}: ${candidates.map(name).join(', ') || 'none'}).`,
      'Add the fluid to the catalog (a row whose name says "DF-50" and "fluid"), or re-activate it, then run this again.',
    )
  }
  for (const f of fluids) log.push(`✓ fluid ${name(f)} $${String(f.dailyRate)} — ${f.department}/${f.type}`)

  const pairs = pairFluidsToMachines(live, fluids)
  const unmatched = pairs.filter((p) => !p.piece)
  if (unmatched.length) {
    throw new TaskRefused(
      `Cannot tell which fluid goes on ${unmatched.map((p) => name(p.parent)).join(', ')}: ${unmatched[0].reason}.`,
      'Name the fluid rows by chemistry ("Water Based" / "Oil Based") to match the machines, or retire the one that is not stocked, then run this again.',
    )
  }

  // ── The fluid bills once, as an expendable ────────────────────────────
  const used = new Map(pairs.map((p) => [p.piece!.id, p.piece!]))
  for (const f of used.values()) {
    const ok = f.department === 'EXPENDABLES' && f.type === 'EXPENDABLE'
    if (Number(f.dailyRate ?? 0) <= 0) {
      result.warnings.push(`${name(f)} has no price — it will print on the quote at $0 until one is set on /inventory.`)
    }
    if (ok) {
      log.push(`· ${f.code} already bills as an expendable`)
      continue
    }
    log.push(`${dryRun ? '→' : '✓'} ${f.code}: ${f.department}/${f.type} → EXPENDABLES/EXPENDABLE (bills qty × rate, once — not per day)`)
    if (!dryRun) {
      await prisma.inventoryItem.update({ where: { id: f.id }, data: { department: 'EXPENDABLES', type: 'EXPENDABLE' } })
      result.touchedIds.push(f.id)
    }
  }

  // ── The links ─────────────────────────────────────────────────────────
  for (const p of pairs) {
    const piece = p.piece!
    const existing = await prisma.inventoryKitPiece.findFirst({
      where: { parentItemId: p.parent.id, pieceItemId: piece.id },
      select: { id: true, qtyPer: true, perUnits: true, rounding: true, minQty: true, billing: true, clientVisible: true, suppressIfOrdered: true, isActive: true },
    })
    const already =
      existing &&
      Number(existing.qtyPer) === DF50_FLUID_PIECE_SETTINGS.qtyPer &&
      existing.perUnits === DF50_FLUID_PIECE_SETTINGS.perUnits &&
      existing.rounding === DF50_FLUID_PIECE_SETTINGS.rounding &&
      existing.minQty === DF50_FLUID_PIECE_SETTINGS.minQty &&
      existing.billing === DF50_FLUID_PIECE_SETTINGS.billing &&
      existing.clientVisible === DF50_FLUID_PIECE_SETTINGS.clientVisible &&
      existing.suppressIfOrdered === DF50_FLUID_PIECE_SETTINGS.suppressIfOrdered &&
      existing.isActive === DF50_FLUID_PIECE_SETTINGS.isActive
    if (already) {
      log.push(`· ${p.parent.code} → ${piece.code} already linked this way`)
      continue
    }
    result.linked++
    const verb = existing ? 'update' : 'create'
    log.push(`${dryRun ? '→' : '✓'} ${verb} ${name(p.parent)} → ${piece.code}: 1 per machine, charged, on the quote`)
    if (dryRun) continue
    if (existing) {
      await prisma.inventoryKitPiece.update({ where: { id: existing.id }, data: DF50_FLUID_PIECE_SETTINGS })
      result.touchedIds.push(existing.id)
    } else {
      const created = await prisma.inventoryKitPiece.create({
        data: { parentItemId: p.parent.id, pieceItemId: piece.id, ...DF50_FLUID_PIECE_SETTINGS },
        select: { id: true },
      })
      result.createdIds.push(created.id)
    }
  }

  if (result.linked === 0 && result.touchedIds.length === 0 && !log.some((l) => l.startsWith('→'))) {
    log.push('Already filed this way — nothing to change.')
  } else if (dryRun) {
    log.push('Dry run — nothing written.')
  } else {
    log.push('Done. A DF-50 added to any order from now on brings its fluid with it; orders already quoted are not touched.')
  }
  return result
}
