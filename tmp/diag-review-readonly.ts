import { prisma } from '../src/lib/prisma'

async function main() {
  const reviews = await prisma.contractReview.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true, originalFilename: true, mimeType: true, fileSize: true,
      fileUrl: true, fileKey: true, createdAt: true, aiRiskLevel: true,
      aiRecommendation: true, humanDecision: true,
      company: { select: { name: true } },
    },
  })
  console.log(JSON.stringify(reviews, null, 2))
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
