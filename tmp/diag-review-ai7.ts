import { prisma } from '../src/lib/prisma'

async function main() {
  const r = await prisma.contractReview.findUnique({
    where: { id: 'ef015a5a-8b3c-4c2e-bcae-db7616b9c6c3' },
    select: { aiResponse: true },
  })
  const ai = r?.aiResponse as any
  console.log('summary:', ai.summary)
  console.log('changes:', ai.changes?.length, 'recommendationNote:', ai.recommendationNote)
  for (const [i, ch] of (ai.changes ?? []).entries()) {
    console.log(`\n--- change[${i}] clause=${ch.clause} type=${ch.type} playbookSource=${ch.playbookSource} needsOpReview=${ch.needsOperatorReview}`)
    console.log('description:', ch.description)
    if (String(ch.clause).includes('7') || /fuel|spill|contractual liability|per occurrence/i.test(JSON.stringify(ch))) {
      console.log('original:', ch.original)
      console.log('proposed:', ch.proposed)
      console.log('reasoning:', ch.reasoning)
      console.log('operatorReviewReason:', ch.operatorReviewReason)
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
