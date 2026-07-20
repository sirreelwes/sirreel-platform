import { prisma } from '../src/lib/prisma'

// Self-owned fixture proving the reservation↔order Job join end to end.
// Every row created here is captured by ID and deleted at the end.
async function main() {
  const company = await prisma.company.findFirst({ select: { id: true } })
  const agent = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } })
  const person = await prisma.person.findFirst({ select: { id: true } })
  const asset = await prisma.asset.findFirst({ where: { isActive: true }, select: { id: true, categoryId: true, unitName: true } })
  if (!company || !agent || !person || !asset) throw new Error('missing anchors')

  const job = await prisma.job.create({
    data: { jobCode: `ZZTEST-JOIN-${process.pid}`, name: 'ZZTEST join check', companyId: company.id, agentId: agent.id },
    select: { id: true },
  })
  const order = await prisma.order.create({
    data: { orderNumber: `ZZTEST-ORD-${process.pid}`, companyId: company.id, agentId: agent.id, jobId: job.id },
    select: { id: true, orderNumber: true },
  })
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  const end = new Date(today); end.setUTCDate(end.getUTCDate() + 2)
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `ZZTEST-BK-${process.pid}`, companyId: company.id, personId: person.id, agentId: agent.id,
      jobId: job.id, jobName: 'ZZTEST join check', startDate: today, endDate: end, status: 'CONFIRMED',
    },
    select: { id: true },
  })
  const item = await prisma.bookingItem.create({
    data: { bookingId: booking.id, categoryId: asset.categoryId, quantity: 1, dailyRate: 0, status: 'ASSIGNED' },
    select: { id: true },
  })
  const assignment = await prisma.bookingAssignment.create({
    data: { bookingItemId: item.id, assetId: asset.id, startDate: today, endDate: end, status: 'ASSIGNED' },
    select: { id: true },
  })

  // Exact route query shape (timeline-native bookings + job.orders)
  const b = await prisma.booking.findUnique({
    where: { id: booking.id },
    select: {
      bookingNumber: true,
      orders: { select: { id: true } },
      job: { select: { orders: { where: { status: { not: 'CANCELLED' } }, select: { id: true, orderNumber: true, status: true } } } },
      items: { select: { category: { select: { name: true } }, assignments: { select: { asset: { select: { unitName: true } } } } } },
    },
  })
  const orders = b!.job?.orders ?? []
  const units = b!.items.flatMap(i => i.assignments.map(a => a.asset.unitName))
  console.log(`booking ${b!.bookingNumber}: hasOrder=${orders.length > 0} orders=[${orders.map(o => o.orderNumber).join(',')}] units=[${units.join(',')}]`)

  // Order-side: exact orders/[id] job.bookings shape
  const o = await prisma.order.findUnique({
    where: { id: order.id },
    select: { job: { select: { bookings: { where: { archivedAt: null, status: { not: 'CANCELLED' } }, select: { items: { select: { assignments: { select: { asset: { select: { unitName: true } } } } } } } } } } },
  })
  const reserved = (o!.job?.bookings ?? []).flatMap(bk => bk.items.flatMap(it => it.assignments.map(a => a.asset.unitName)))
  console.log(`order ${order.orderNumber}: reserved units=[${reserved.join(',')}]`)

  // Cleanup — captured IDs only, reverse dependency order.
  await prisma.bookingAssignment.delete({ where: { id: assignment.id } })
  await prisma.bookingItem.delete({ where: { id: item.id } })
  await prisma.booking.delete({ where: { id: booking.id } })
  await prisma.order.delete({ where: { id: order.id } })
  await prisma.job.delete({ where: { id: job.id } })
  console.log('fixture cleaned by captured IDs')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
