import { prisma } from '../src/lib/prisma'
import { computeDays } from '../src/lib/orders/days'

async function main() {
  const rows = await prisma.orderLineItem.findMany({
    where: { computedDays: null },
    select: { id: true, pickupDate: true, returnDate: true },
  })
  console.log(`backfilling computedDays on ${rows.length} lines`)
  let n = 0
  for (const r of rows) {
    await prisma.orderLineItem.update({
      where: { id: r.id },
      data: { computedDays: computeDays(r.pickupDate, r.returnDate) },
    })
    n++
  }
  console.log(`done: ${n} lines backfilled`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
