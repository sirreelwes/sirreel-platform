import { prisma } from '../src/lib/prisma'
async function main() {
  // Mirror the fixed route logic for the Hills job's two bookings
  const bookings = await prisma.booking.findMany({
    where: { archivedAt: null, jobName: 'Hills' },
    select: {
      id: true, bookingNumber: true,
      job: { select: { id: true } },
      items: { select: { category: { select: { name: true } }, assignments: { select: { asset: { select: { unitName: true } } } } } },
    },
  })
  const jobUnits = new Map<string, Array<{ unitName: string; bookingNumber: string }>>()
  for (const b of bookings) {
    if (!b.job?.id) continue
    const arr = jobUnits.get(b.job.id) ?? []
    for (const it of b.items) for (const a of it.assignments) arr.push({ unitName: a.asset.unitName, bookingNumber: b.bookingNumber })
    jobUnits.set(b.job.id, arr)
  }
  for (const b of bookings) {
    for (const it of b.items) for (const a of it.assignments) {
      const sibs = (jobUnits.get(b.job!.id) ?? []).filter(u => !(u.unitName === a.asset.unitName && u.bookingNumber === b.bookingNumber))
      console.log(`bar ${a.asset.unitName} (${b.bookingNumber}) → siblings: [${sibs.map(s => `${s.unitName}@${s.bookingNumber}`).join(', ')}]`)
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
