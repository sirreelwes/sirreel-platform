import { readFile } from 'fs/promises'
import { prisma } from '../src/lib/prisma'
import { runContractReviewAi } from '../src/lib/contracts/runReview'

async function main() {
  const buf = await readFile(process.env.SCRATCH + '/blackdog-return.pdf')
  const wes = await prisma.user.findUnique({ where: { email: 'wes@sirreel.com' }, select: { id: true } })
  const company = await prisma.company.findFirst({ where: { name: { contains: 'Black Dog', mode: 'insensitive' } }, select: { id: true, name: true } })
  const job = await prisma.job.findUnique({ where: { jobCode: 'SR-JOB-0054' }, select: { id: true, jobCode: true } })
  console.log('anchors:', company?.name, job?.jobCode)

  const result = await runContractReviewAi({ uploadedPdf: buf, companyName: company?.name || 'Black Dog Films' })
  if (!result.ok) throw new Error(`${result.status}: ${result.error}`)
  const review = result.review
  review._meta = { ...(review._meta || {}), secondRoundClauses: [], completedFailedUploadOf: 'contracts/2026/07/2a379b43-dd10-4ebc-b2fe-25757f490542.pdf' }

  const rec = await prisma.contractReview.create({
    data: {
      fileKey: 'contracts/2026/07/2a379b43-dd10-4ebc-b2fe-25757f490542.pdf',
      fileUrl: 'https://bcq1ijd3eb7xz1ch.private.blob.vercel-storage.com/contracts/2026/07/2a379b43-dd10-4ebc-b2fe-25757f490542.pdf',
      originalFilename: 'Annual Rental Agreement signed-counter BlackDog 2026.pdf',
      fileSize: buf.length,
      mimeType: 'application/pdf',
      companyId: company?.id ?? null,
      jobId: job?.id ?? null,
      uploadedById: wes!.id,
      aiResponse: review,
      aiRiskLevel: typeof review.riskLevel === 'string' ? review.riskLevel : null,
      aiRecommendation: typeof review.recommendation === 'string' ? review.recommendation : null,
      annotationManifest: JSON.parse(JSON.stringify(result.annotationManifest)) as object,
    },
    select: { id: true },
  })
  console.log('review created:', rec.id)
  console.log('meta:', JSON.stringify(review._meta?.multimodal), 'redlineSourceUnknown:', review._meta?.redlineSourceUnknown)
  console.log('recommendation:', review.recommendation, '| risk:', review.riskLevel, '| changes:', review.changes?.length)
  console.log('summary:', review.summary)
  for (const ch of review.changes ?? []) {
    const sa = ch.sourceAgreement || {}
    console.log(`\n=== §${ch.clause} [${ch.type}] opReview=${ch.needsOperatorReview} agree=${sa.agree}`)
    console.log('  description:', ch.description)
    console.log('  manifest view:', sa.manifest ?? '—')
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
