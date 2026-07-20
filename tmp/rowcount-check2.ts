import { prisma } from '../src/lib/prisma'
async function main() {
  const roster = await prisma.asset.findMany({
    where: { category: { reservableOnGantt: true } },
    select: { unitName: true, isActive: true, category: { select: { name: true } } },
  })
  const byCat = new Map<string, { rows: number; idle: number }>()
  for (const r of roster) {
    const s = byCat.get(r.category.name) ?? { rows: 0, idle: 0 }
    s.rows++; if (!r.isActive) s.idle++
    byCat.set(r.category.name, s)
  }
  for (const [name, s] of [...byCat].sort()) console.log(`${name}: ${s.rows} rows${s.idle ? ` (${s.idle} idle: now visible)` : ''}`)
  console.log('total rows:', roster.length)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
