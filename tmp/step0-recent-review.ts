import { prisma } from '../src/lib/prisma'
async function main() {
  const r = await prisma.contractReview.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, originalFilename: true, createdAt: true, fileKey: true, annotationManifest: true, aiResponseHistory: true },
  })
  if (!r) { console.log('no reviews'); return }
  const m = r.annotationManifest as any
  console.log('most recent review:', r.id, '|', r.originalFilename, '|', r.createdAt.toISOString())
  console.log('fileKey:', r.fileKey)
  console.log('manifest:', m ? `struck=${m.struck?.length} inserted=${m.inserted?.length} unmapped=${m.unmapped?.length} pages=${m.pages}` : 'NULL')
  console.log('history entries:', Array.isArray(r.aiResponseHistory) ? (r.aiResponseHistory as any[]).length : 0)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
