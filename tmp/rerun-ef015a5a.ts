import { prisma } from '../src/lib/prisma'
import { rerunContractReview } from '../src/lib/contracts/rerunReview'

async function main() {
  const wes = await prisma.user.findUnique({ where: { email: 'wes@sirreel.com' }, select: { id: true } })
  if (!wes) throw new Error('wes user not found')
  const result = await rerunContractReview({
    reviewId: 'ef015a5a-8b3c-4c2e-bcae-db7616b9c6c3',
    rerunById: wes.id,
    secondRoundClauses: [],
  })
  if (!result.ok) throw new Error(`${result.status}: ${result.error}`)
  const rv = result.review
  console.log('recommendation:', rv.recommendation, '| risk:', rv.riskLevel)
  console.log('summary:', rv.summary)
  for (const ch of rv.changes) {
    console.log(`\n=== §${ch.clause} [${ch.type}] opReview=${ch.needsOperatorReview}`)
    console.log('description:', ch.description)
    if (String(ch.clause) === '7' || String(ch.clause) === '8') {
      console.log('PROPOSED:', ch.proposed)
      console.log('reasoning:', ch.reasoning)
      if (ch.operatorReviewReason) console.log('opReviewReason:', ch.operatorReviewReason)
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
