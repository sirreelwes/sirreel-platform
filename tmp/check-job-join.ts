import { prisma } from '../src/lib/prisma'
async function main() {
  const withJob = await prisma.booking.count({ where: { archivedAt: null, jobId: { not: null } } })
  const total = await prisma.booking.count({ where: { archivedAt: null } })
  console.log(`bookings with jobId: ${withJob}/${total}`)
  const viaJob = await prisma.booking.findMany({
    where: { archivedAt: null, job: { orders: { some: { status: { not: 'CANCELLED' } } } } },
    select: {
      bookingNumber: true,
      job: { select: { jobCode: true, orders: { select: { orderNumber: true, status: true } } } },
      items: { select: { assignments: { select: { asset: { select: { unitName: true } } } } } },
    },
    take: 8,
  })
  for (const b of viaJob) {
    const units = b.items.flatMap(i => i.assignments.map(a => a.asset.unitName))
    console.log(`${b.bookingNumber} [${b.job?.jobCode}]: orders=[${b.job?.orders.map(o => o.orderNumber).join(', ')}] units=[${units.join(', ')}]`)
  }
  console.log('bookings whose JOB has orders:', await prisma.booking.count({ where: { archivedAt: null, job: { orders: { some: {} } } } }))
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
