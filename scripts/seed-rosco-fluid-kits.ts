/**
 * The Rosco machines ship with their fluid, and the client pays for it.
 *
 *   npx tsx scripts/seed-rosco-fluid-kits.ts            # dry run
 *   npx tsx scripts/seed-rosco-fluid-kits.ts --write
 *
 * Oliver, 2026-09-14, via Wes: "The Roscos don't come pre-juiced.
 * Therefore, the juice should be a part of the package."
 *   Rosco V-Hazer (water-based)  — add-on Rosco V-Hazer fluid, 4 liter jug
 *   Rosco Fogger 1900            — add-on Rosco Fog fluid, 1 liter
 *   Fogger - Rosco Vapour        — add-on Rosco Fog fluid, 1 liter
 * Wes, 2026-09-15: "charge for fluid — it has a price in expendables."
 *
 * So each is a CHARGED kit piece, one bottle per machine, printed on the
 * quote (a charge the client cannot see is a charge they will dispute).
 * suppressIfOrdered stays on: a client who lists fluid themselves keeps
 * their line and does not get billed for a second jug. The DF-50 is NOT
 * here — it goes out pre-juiced; its extra gallon is an ordinary add-on.
 *
 * THE FLUID MUST BILL AS AN EXPENDABLE, and on 2026-09-15 it did not.
 * The 2026-09-11 re-flattening left both rows under PRO_SUPPLIES, which
 * bills rate × days (capped at 3 a week): a $92.50 jug on a three-day
 * rental would have charged $277.50. A kit line takes its department and
 * type from the piece row, so the rows are moved to EXPENDABLES /
 * EXPENDABLE here — PURCHASE model, qty × rate, once. Neither row was on
 * any order line when this was written, so no existing money moves.
 * Only these two rows: the wider flattening (242 active items in the
 * Expendables category) is its own decision, not a side effect of this.
 *
 * Twins: the V-Hazer exists twice (an RW import and a hand-entered EFX
 * row), both certainly the same machine, so both get the piece — a kit on
 * one twin means an order built off the other ships dry. The inactive
 * "Rosco 1900 Fogger" row is skipped; nothing can order it.
 *
 * Refuses to run if any code fails to resolve. Idempotent: an existing
 * kit link for the same parent + piece is updated to these settings, not
 * duplicated. --write journals every id it created or changed.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'
const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')

/** The fluid rows, and what they must bill as. */
const FLUIDS = ['RVHAZER', 'FOG1'] as const

const KITS: { machine: string; parents: string[]; piece: (typeof FLUIDS)[number] }[] = [
  { machine: 'Rosco V-Hazer (water-based)', parents: ['103859', 'EFX-ROSCOE-V-HAZER-WATER-BASED'], piece: 'RVHAZER' },
  { machine: 'Rosco Fogger 1900', parents: ['EFX-ROSCOE-FOGGER-1900'], piece: 'FOG1' },
  { machine: 'Fogger - Rosco Vapour', parents: ['104455'], piece: 'FOG1' },
]

const PIECE_SETTINGS = {
  qtyPer: 1,
  perUnits: 1,
  rounding: 'CEIL' as const,
  minQty: 0,
  billing: 'CHARGED' as const,
  clientVisible: true,
  suppressIfOrdered: true,
  isActive: true,
}

async function main() {
  const codes = [...new Set([...FLUIDS, ...KITS.flatMap((k) => k.parents)])]
  const rows = await prisma.inventoryItem.findMany({
    where: { code: { in: codes } },
    select: {
      id: true, code: true, description: true, department: true, type: true, dailyRate: true, isActive: true,
      _count: { select: { lineItems: true } },
    },
  })
  const byCode = new Map(rows.map((r) => [r.code, r]))
  const missing = codes.filter((c) => !byCode.get(c) || !byCode.get(c)!.isActive)
  if (missing.length) throw new Error(`Refusing: these codes are missing or inactive: ${missing.join(', ')}`)

  const journal: Record<string, unknown>[] = []

  console.log('── Fluid rows (must bill once, as an expendable)')
  for (const code of FLUIDS) {
    const r = byCode.get(code)!
    const ok = r.department === 'EXPENDABLES' && r.type === 'EXPENDABLE'
    console.log(`  ${code.padEnd(8)} ${r.description} $${r.dailyRate} — ${r.department}/${r.type}${ok ? ' (already right)' : ' → EXPENDABLES/EXPENDABLE'} · on ${r._count.lineItems} order line(s)`)
    if (!ok && WRITE) {
      await prisma.inventoryItem.update({ where: { id: r.id }, data: { department: 'EXPENDABLES', type: 'EXPENDABLE' } })
      journal.push({ kind: 'item.department', id: r.id, code, from: { department: r.department, type: r.type }, to: { department: 'EXPENDABLES', type: 'EXPENDABLE' } })
    }
  }

  console.log('\n── Kit pieces (CHARGED, 1 per machine, on the quote)')
  for (const k of KITS) {
    const piece = byCode.get(k.piece)!
    for (const code of k.parents) {
      const parent = byCode.get(code)!
      const existing = await prisma.inventoryKitPiece.findFirst({
        where: { parentItemId: parent.id, pieceItemId: piece.id },
      })
      const verb = existing ? 'update' : 'create'
      console.log(`  ${verb.padEnd(6)} ${parent.code} "${parent.description}" → ${piece.code} "${piece.description}" @ $${piece.dailyRate}`)
      if (!WRITE) continue
      if (existing) {
        await prisma.inventoryKitPiece.update({ where: { id: existing.id }, data: PIECE_SETTINGS })
        journal.push({ kind: 'kit.update', id: existing.id, parent: parent.code, piece: piece.code, before: existing })
      } else {
        const created = await prisma.inventoryKitPiece.create({
          data: { parentItemId: parent.id, pieceItemId: piece.id, ...PIECE_SETTINGS },
          select: { id: true },
        })
        journal.push({ kind: 'kit.create', id: created.id, parent: parent.code, piece: piece.code })
      }
    }
  }

  if (!WRITE) {
    console.log('\nDry run — add --write to apply.')
    return
  }
  mkdirSync('journals', { recursive: true })
  const file = `journals/rosco-fluid-kits-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify({ ranAt: new Date().toISOString(), entries: journal }, null, 2))
  console.log(`\nWrote ${journal.length} change(s). Journal: ${file} — undo by these ids only.`)
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
  .finally(() => prisma.$disconnect())
