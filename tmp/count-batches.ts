import { prisma } from '../src/lib/prisma'
async function main() {
  const all = await prisma.bookingAssignment.findMany({ select: { createdAt: true } })
  const byMinute = new Map<string, number>()
  for (const a of all) {
    const k = a.createdAt.toISOString().slice(0, 16)
    byMinute.set(k, (byMinute.get(k) ?? 0) + 1)
  }
  for (const [k, n] of [...byMinute].sort()) console.log(k, n)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
