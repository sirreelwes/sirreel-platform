import { readFile } from 'fs/promises'
import { prisma } from '../src/lib/prisma'
import { buildAnnotationManifest, formatManifestForPrompt } from '../src/lib/contracts/annotationManifest'
import { applyPostAiGuardrails } from '../src/lib/contracts/runReview'

async function main() {
  const buf = await readFile(process.env.SCRATCH + '/black-dog-redline.pdf')
  const manifest = await buildAnnotationManifest(buf)
  const r = await prisma.contractReview.findUnique({
    where: { id: 'ef015a5a-8b3c-4c2e-bcae-db7616b9c6c3' },
    select: { aiResponse: true },
  })
  const copy = JSON.parse(JSON.stringify(r!.aiResponse)) // offline copy, never written back
  applyPostAiGuardrails(copy, manifest)
  for (const ch of copy.changes) {
    console.log(`§${ch.clause} needsOpReview=${ch.needsOperatorReview}${ch.operatorReviewReason ? ' — ' + ch.operatorReviewReason : ''}`)
  }
  console.log('\nprompt block chars:', formatManifestForPrompt(manifest).length)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
