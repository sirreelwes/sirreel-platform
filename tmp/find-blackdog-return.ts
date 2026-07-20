import { prisma } from '../src/lib/prisma'
async function main() {
  const r = await prisma.contractReview.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, originalFilename: true, createdAt: true, fileKey: true, annotationManifest: true, aiResponse: true, job: { select: { jobCode: true } }, company: { select: { name: true } } },
  })
  console.log(r!.id, '|', r!.originalFilename, '|', r!.createdAt.toISOString(), '|', r!.company?.name, r!.job?.jobCode)
  console.log('fileKey:', r!.fileKey)
  console.log('manifest:', r!.annotationManifest ? 'present' : 'NULL')
  const ai = r!.aiResponse as any
  console.log('aiResponse summary:', String(ai?.summary ?? ai?.error ?? '').slice(0, 140))
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
