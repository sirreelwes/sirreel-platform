import { prisma } from '../src/lib/prisma'
import { rerunContractReview } from '../src/lib/contracts/rerunReview'

async function main() {
  const wes = await prisma.user.findUnique({ where: { email: 'wes@sirreel.com' }, select: { id: true } })
  const result = await rerunContractReview({
    reviewId: 'fd97acb0-b84f-402c-b243-81fcb7f31f6b',
    rerunById: wes!.id,
    secondRoundClauses: [],
  })
  if (!result.ok) throw new Error(`${result.status}: ${result.error}`)
  const rv = result.review
  console.log('meta:', JSON.stringify(rv._meta?.multimodal), '| redlineSourceUnknown:', rv._meta?.redlineSourceUnknown)
  console.log('recommendation:', rv.recommendation, '| risk:', rv.riskLevel, '| changes:', rv.changes?.length)
  console.log('summary:', rv.summary)
  console.log('\n=== PER-CLAUSE SOURCE TABLE ===')
  for (const ch of rv.changes ?? []) {
    const sa = ch.sourceAgreement || {}
    console.log(`\n§${ch.clause} [${ch.type}] opReview=${ch.needsOperatorReview} agree=${sa.agree}`)
    console.log(`  text layer: ${sa.textLayer ?? '—'}`)
    console.log(`  manifest:   ${sa.manifest ?? '—'}`)
    console.log(`  image:      ${sa.image ?? '—'}`)
    console.log(`  finding:    ${ch.description}`)
  }
  const hist = await prisma.contractReview.findUnique({
    where: { id: 'fd97acb0-b84f-402c-b243-81fcb7f31f6b' },
    select: { aiResponseHistory: true, annotationManifest: true },
  })
  console.log('\nhistory entries now:', (hist!.aiResponseHistory as any[]).length, '| manifest persisted:', hist!.annotationManifest != null)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
