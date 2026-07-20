import { prisma } from '../src/lib/prisma'
async function main() {
  const r = await prisma.contractReview.findUnique({
    where: { id: 'ef015a5a-8b3c-4c2e-bcae-db7616b9c6c3' },
    select: {
      aiResponseHistory: true, annotationManifest: true, aiResponse: true,
      humanDecision: true, humanDecisionNote: true,
      changeDecisions: { select: { id: true, decision: true, updatedAt: true } },
    },
  })
  const hist = r!.aiResponseHistory as any[]
  console.log('history entries:', hist.length, '| archivedAt:', hist[0]?.archivedAt)
  console.log('old §7 proposed retained-strikes present in archive:',
    JSON.stringify(hist[0]?.aiResponse?.changes?.[2]?.proposed ?? '').includes('per occurrence'))
  const m = r!.annotationManifest as any
  console.log('manifest persisted:', !!m, '| struck:', m?.struck?.length, '| inserted:', m?.inserted?.length, '| unmapped:', m?.unmapped?.length)
  console.log('new rerunAt:', (r!.aiResponse as any)?._meta?.rerunAt)
  console.log('humanDecision:', r!.humanDecision, '| note:', r!.humanDecisionNote)
  console.log('changeDecisions rows:', r!.changeDecisions.length)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
