import { prisma } from '../src/lib/prisma'
async function main() {
  const r = await prisma.contractReview.findUnique({
    where: { id: 'ef015a5a-8b3c-4c2e-bcae-db7616b9c6c3' },
    select: { aiResponse: true },
  })
  const ch = (r?.aiResponse as any).changes[2]
  console.log('clause:', ch.clause)
  console.log('suggestedCounter:', ch.suggestedCounter)
  console.log('counterReasoning:', ch.counterReasoning)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
