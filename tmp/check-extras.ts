import { prisma } from '../src/lib/prisma'
async function main() {
  const bookings = await prisma.booking.findMany({
    where: { archivedAt: null, orders: { some: {} } },
    select: {
      bookingNumber: true,
      orders: { select: { orderNumber: true, status: true } },
      items: { select: { category: { select: { name: true } }, assignments: { select: { asset: { select: { unitName: true } } } } } },
    },
    take: 5,
  })
  for (const b of bookings) {
    const units = b.items.flatMap(i => i.assignments.map(a => a.asset.unitName))
    console.log(`${b.bookingNumber}: orders=[${b.orders.map(o => o.orderNumber).join(', ')}] units=[${units.join(', ')}]`)
  }
  console.log('bookings with orders:', await prisma.booking.count({ where: { archivedAt: null, orders: { some: {} } } }))
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
