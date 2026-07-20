import { prisma } from '../src/lib/prisma'
async function main() {
  const total = await prisma.bookingAssignment.count()
  console.log('total assignments:', total)
  const all = await prisma.bookingAssignment.findMany({
    select: {
      id: true, assetId: true, startDate: true, endDate: true, createdAt: true,
      asset: { select: { unitName: true } },
      bookingItem: { select: { id: true, quantity: true, booking: { select: { bookingNumber: true } } } },
    },
  })
  // duplicates: same asset on same booking
  const byBookingAsset = new Map<string, typeof all>()
  for (const a of all) {
    const k = `${a.bookingItem.booking.bookingNumber}|${a.assetId}`
    const arr = byBookingAsset.get(k) ?? []
    arr.push(a); byBookingAsset.set(k, arr)
  }
  for (const [k, arr] of byBookingAsset) {
    if (arr.length > 1) console.log('DUP same booking+asset:', k, arr.map(a => `${a.asset.unitName} ${a.startDate.toISOString().slice(0,10)}→${a.endDate.toISOString().slice(0,10)} created ${a.createdAt.toISOString().slice(11,19)}`))
  }
  // over-capacity items
  const items = await prisma.bookingItem.findMany({
    where: { assignments: { some: {} } },
    select: { id: true, quantity: true, _count: { select: { assignments: true } }, booking: { select: { bookingNumber: true } } },
  })
  for (const i of items) {
    if (i._count.assignments > i.quantity) console.log('OVER-CAPACITY item:', i.booking.bookingNumber, `qty=${i.quantity} assignments=${i._count.assignments}`)
  }
  console.log('items with assignments:', items.length)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
