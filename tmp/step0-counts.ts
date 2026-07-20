import { prisma } from '../src/lib/prisma'
async function main() {
  const [assets, items, assignments, liveBookings, reservations] = await Promise.all([
    prisma.asset.count({ where: { isActive: true } }),
    prisma.bookingItem.count(),
    prisma.bookingAssignment.count(),
    prisma.booking.count({ where: { status: { notIn: ['CANCELLED', 'ARCHIVED'] }, archivedAt: null } }),
    prisma.reservation.count(),
  ])
  console.log({ assets, items, assignments, liveBookings, reservations })
  const unassigned = await prisma.bookingItem.count({ where: { status: 'REQUESTED', booking: { status: { notIn: ['CANCELLED', 'ARCHIVED'] }, archivedAt: null } } })
  const assignedItems = await prisma.bookingItem.count({ where: { assignments: { some: {} } } })
  console.log({ unassignedLiveItems: unassigned, itemsWithAssignments: assignedItems })
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
