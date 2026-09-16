/**
 * Which cargo vans does HQ believe have a liftgate — and does that match
 * the yard?
 *
 * READ-ONLY. Writes nothing, to any table.
 *
 * ── Why this exists ────────────────────────────────────────────────
 * Wes, 2026-09-16: "Cargo vans #20-25 do not have lift gates and
 * apparently it is not indicated that way in reservations or orders."
 *
 * There is no `hasLiftgate` field anywhere. `Asset` carries VIN, plate,
 * year, make, model, mileage — and nothing about a liftgate. The ONLY
 * thing in the system that says a van has one is WHICH AssetCategory the
 * Asset row sits in: "Cargo Van w/ Liftgate" or "Cargo Van w/o Liftgate".
 *
 * That single fact drives everything downstream:
 *   • the reservations board prints the CATEGORY name under the unit
 *     name (`resourceName` in /api/timeline-native), so a mis-filed van
 *     is labelled as having a liftgate on the board;
 *   • an order line holds against a category
 *     (`legacyAssetCategoryId` → holdCategoryId in the line-items
 *     route), and the assign picker only offers units from THAT
 *     category (booking-items/[id]/available-units) — so a mis-filed van
 *     is offered as fulfilment for an order that bought a liftgate;
 *   • nothing further down can catch it, because nothing else records
 *     the fact.
 *
 * So "is it indicated correctly?" is answerable only by reading which
 * category each van is in. That is what this prints.
 *
 * ── Prior art worth knowing ────────────────────────────────────────
 * `PLANYO_UNIT_CATEGORY_OVERRIDES` in src/lib/scheduling/planyoNameNormalizer.ts
 * deliberately binds Cargo 20 / 21 / 23 / 24 to the w/-LIFTGATE category,
 * on this stated premise: "Planyo's categorization is stale for these
 * units: it files them under 'Cargo Vans w/o Liftgate' but the physical
 * vans live in HQ's 'Cargo Van w/ Liftgate' category. Ruling by Wes
 * 2026-07-15." The 2026-09-16 report contradicts that premise — if the
 * vans have no liftgates, Planyo was right and HQ's filing is the stale
 * side. Read the output below before changing that map.
 *
 * Usage:
 *   npx tsx scripts/audit-liftgate-categories.ts
 *   npx tsx scripts/audit-liftgate-categories.ts --no-liftgate 20,21,22,23,24,25
 */

import { prisma } from '../src/lib/prisma'

/** Units the YARD says have no liftgate. Wes 2026-09-16: #20-25. */
const DEFAULT_NO_LIFTGATE = [20, 21, 22, 23, 24, 25]

function parseUnits(): number[] {
  const i = process.argv.indexOf('--no-liftgate')
  if (i === -1 || !process.argv[i + 1]) return DEFAULT_NO_LIFTGATE
  return process.argv[i + 1]
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
}

/** "Cargo 21" → 21. Null for anything that isn't a numbered cargo van. */
function cargoNumber(unitName: string): number | null {
  const m = /^\s*cargo\s*#?\s*(\d+)\s*$/i.exec(unitName)
  return m ? Number(m[1]) : null
}

function says(categoryName: string): 'has' | 'none' | 'unclear' {
  const n = categoryName.toLowerCase()
  if (/w\/?o\s*lift|without\s*lift|no\s*lift/.test(n)) return 'none'
  if (/lift\s*gate|liftgate/.test(n)) return 'has'
  return 'unclear'
}

async function main() {
  const noLiftgate = new Set(parseUnits())
  console.log(`\nYard says these have NO liftgate: ${[...noLiftgate].sort((a, b) => a - b).join(', ')}\n`)

  // ── 1. Every cargo-ish asset, and the category it is filed under ──
  const assets = await prisma.asset.findMany({
    where: { unitName: { startsWith: 'Cargo', mode: 'insensitive' } },
    select: {
      id: true,
      unitName: true,
      isActive: true,
      status: true,
      licensePlate: true,
      category: { select: { id: true, name: true, slug: true, isActive: true } },
    },
    orderBy: [{ unitName: 'asc' }],
  })

  if (assets.length === 0) {
    console.log('No assets whose unitName starts with "Cargo". Nothing to audit.')
    return
  }

  console.log('── Every Cargo asset, and what its category CLAIMS ──────────────')
  const mismatched: typeof assets = []
  const byName = new Map<string, typeof assets>()
  for (const a of assets) {
    const n = cargoNumber(a.unitName)
    const claim = says(a.category.name)
    const expected: 'has' | 'none' | null = n === null ? null : noLiftgate.has(n) ? 'none' : 'has'
    const wrong = expected !== null && claim !== 'unclear' && claim !== expected
    if (wrong) mismatched.push(a)
    byName.set(a.unitName, [...(byName.get(a.unitName) ?? []), a])
    const flag = wrong ? '  ← MISMATCH' : ''
    const dead = a.isActive ? '' : '  (inactive)'
    console.log(
      `  ${a.unitName.padEnd(12)} ${a.category.name.padEnd(26)} claims: ${claim.padEnd(8)}${dead}${flag}`,
    )
  }

  // ── 2. The same unit name filed under more than one category ──────
  const dupes = [...byName.entries()].filter(([, rows]) => rows.length > 1)
  if (dupes.length) {
    console.log('\n── Same unit name, more than one asset row ──────────────────────')
    console.log('   (the board draws one row per ASSET, so these appear twice)')
    for (const [name, rows] of dupes) {
      console.log(`  ${name}:`)
      for (const r of rows) {
        console.log(`      ${r.category.name.padEnd(26)} active=${r.isActive} id=${r.id}`)
      }
    }
  }

  if (mismatched.length === 0) {
    console.log('\nNo category mismatches. Every Cargo asset is filed the way the yard describes it.')
  } else {
    console.log(`\n${mismatched.length} asset row(s) filed against what the yard says.`)
  }

  // ── 3. Live exposure: who BOUGHT a liftgate and is scheduled one of these ──
  const mismatchedIds = mismatched.map((a) => a.id)
  if (mismatchedIds.length) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const exposure = await prisma.bookingAssignment.findMany({
      where: {
        assetId: { in: mismatchedIds },
        // AssignmentStatus has no CANCELLED — a dropped unit is SWAPPED,
        // a finished one RETURNED. Live means still going out or already out.
        status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
        endDate: { gte: today },
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        asset: { select: { unitName: true, category: { select: { name: true } } } },
        bookingItem: {
          select: {
            category: { select: { name: true } },
            booking: {
              select: {
                bookingNumber: true,
                jobName: true,
                status: true,
                company: { select: { name: true } },
                job: { select: { id: true, jobCode: true } },
              },
            },
          },
        },
      },
      orderBy: { startDate: 'asc' },
    })

    const bought = exposure.filter((e) => says(e.bookingItem.category.name) === 'has')
    console.log('\n── Live exposure: booked a LIFTGATE, scheduled a van without one ──')
    if (bought.length === 0) {
      console.log('  None on or after today. (Past rentals are not listed.)')
    } else {
      for (const e of bought) {
        const b = e.bookingItem.booking
        const win = `${e.startDate.toISOString().slice(0, 10)} → ${e.endDate.toISOString().slice(0, 10)}`
        console.log(
          `  ${e.asset.unitName.padEnd(12)} ${win}  ${b.bookingNumber}  ${b.company?.name ?? 'no company'} · ${b.jobName || 'unnamed'}`,
        )
        console.log(
          `      booked: ${e.bookingItem.category.name}   ·   filed under: ${e.asset.category.name}${b.job?.jobCode ? `   ·   ${b.job.jobCode}` : ''}`,
        )
      }
      console.log(`\n  ${bought.length} upcoming rental(s) where the client bought a liftgate.`)
    }
  }

  // ── 4. What each category currently holds, for the recount ────────
  console.log('\n── Cargo categories ────────────────────────────────────────────')
  const cats = await prisma.assetCategory.findMany({
    where: { name: { contains: 'Cargo', mode: 'insensitive' } },
    select: { id: true, name: true, slug: true, totalUnits: true, isActive: true, _count: { select: { assets: true } } },
    orderBy: { name: 'asc' },
  })
  for (const c of cats) {
    console.log(
      `  ${c.name.padEnd(26)} assets=${String(c._count.assets).padStart(3)}  totalUnits=${String(c.totalUnits).padStart(3)}  active=${c.isActive}`,
    )
    if (c._count.assets !== c.totalUnits) {
      console.log(`      ⚠ totalUnits disagrees with the asset count — availability math reads totalUnits`)
    }
  }
  console.log('')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
