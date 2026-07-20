import { prisma } from '../src/lib/prisma'
async function main() {
  const rows = await prisma.reviewChangeDecision.findMany({
    where: { reviewId: 'ef015a5a-8b3c-4c2e-bcae-db7616b9c6c3' },
    orderBy: { changeIndex: 'asc' },
    select: { changeIndex: true, clauseRef: true, decision: true, note: true },
  })
  for (const r of rows) console.log(r.changeIndex, r.clauseRef, r.decision, r.note ? `note: ${r.note.slice(0, 40)}` : '')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
