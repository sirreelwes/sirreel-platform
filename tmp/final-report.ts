import { prisma } from '../src/lib/prisma'
async function main() {
  const bookings = await prisma.booking.findMany({
    where: { source: 'PLANYO_BACKFILL', status: { notIn: ['CANCELLED', 'ARCHIVED'] }, archivedAt: null },
    select: {
      bookingNumber: true, jobName: true,
      items: { select: { quantity: true, status: true, _count: { select: { assignments: true } }, assignments: { select: { asset: { select: { unitName: true } } } } } },
    },
    orderBy: { bookingNumber: 'asc' },
  })
  let fullyAssigned = 0, partial = 0, none = 0
  for (const b of bookings) {
    const q = b.items.reduce((s, i) => s + i.quantity, 0)
    const a = b.items.reduce((s, i) => s + i._count.assignments, 0)
    const units = b.items.flatMap(i => i.assignments.map(x => x.asset.unitName)).join(', ')
    const state = a === 0 ? 'NONE' : a >= q ? 'FULL' : 'PARTIAL'
    if (state === 'FULL') fullyAssigned++; else if (state === 'PARTIAL') partial++; else none++
    console.log(`${b.bookingNumber} ${state} ${a}/${q}${units ? ' — ' + units : ''}`)
  }
  console.log(`\nbookings: ${bookings.length} | fully assigned: ${fullyAssigned} | partial: ${partial} | none: ${none}`)
  const totalAssign = await prisma.bookingAssignment.count()
  console.log('total BookingAssignments:', totalAssign)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
