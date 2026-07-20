import { prisma } from '../src/lib/prisma'
async function main() {
  const bookings = await prisma.booking.findMany({
    where: {
      archivedAt: null,
      OR: [
        { jobName: { contains: 'Hills', mode: 'insensitive' } },
        { company: { name: { contains: 'North of Now', mode: 'insensitive' } } },
      ],
    },
    select: {
      id: true, bookingNumber: true, jobName: true, jobId: true, status: true,
      company: { select: { name: true } },
      items: { select: { category: { select: { name: true } }, assignments: { select: { asset: { select: { unitName: true } } } } } },
    },
  })
  for (const b of bookings) {
    const units = b.items.flatMap(i => i.assignments.map(a => a.asset.unitName))
    console.log(`${b.bookingNumber} job=${b.jobId ?? 'NULL'} "${b.jobName}" [${b.company.name}] status=${b.status} units=[${units.join(', ')}]`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
