import { prisma } from '../src/lib/prisma'
async function main() {
  const r = await prisma.contractReview.findUnique({
    where: { id: 'ef015a5a-8b3c-4c2e-bcae-db7616b9c6c3' },
    select: { updatedAt: true, aiResponseHistory: true, annotationManifest: true, aiResponse: true },
  })
  console.log('updatedAt:', r!.updatedAt.toISOString())
  console.log('history entries:', Array.isArray(r!.aiResponseHistory) ? (r!.aiResponseHistory as any[]).length : 'none')
  console.log('manifest present:', r!.annotationManifest != null)
  console.log('rerunAt:', (r!.aiResponse as any)?._meta?.rerunAt ?? 'none')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
