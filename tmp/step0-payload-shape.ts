import { get } from '@vercel/blob'
import { writeFile } from 'fs/promises'
import { prisma } from '../src/lib/prisma'
import { buildAnnotationManifest, formatManifestForPrompt, manifestHasMarkup } from '../src/lib/contracts/annotationManifest'
import { buildContractReviewSystemPrompt } from '../src/lib/contracts/reviewPrompt'
import { readFile } from 'fs/promises'
import path from 'path'

async function main() {
  const key = 'contracts/2026/07/9617158d-766d-47fe-af16-18ad5ed4920a.pdf'
  const blob = await get(key, { access: 'private' })
  if (!blob?.stream) throw new Error('blob fetch failed')
  const chunks: Buffer[] = []
  for await (const c of blob.stream as any) chunks.push(Buffer.from(c))
  const buf = Buffer.concat(chunks)
  await writeFile(process.env.SCRATCH + '/newest-review.pdf', buf)
  console.log('blob:', buf.length, 'bytes')

  // Reconstruct the EXACT content array runContractReviewAi builds today
  const uploadedBase64 = buf.toString('base64')
  const standardBase64 = (await readFile(path.join(process.cwd(), 'public/contracts/sirreel-rental-agreement.pdf'))).toString('base64')
  let manifest = null as any
  let manifestError: string | null = null
  try { manifest = await buildAnnotationManifest(buf) } catch (e: any) { manifestError = e?.message }
  const content: any[] = [
    { type: 'document', media_type: 'application/pdf', bytes: uploadedBase64.length },
    { type: 'document', media_type: 'application/pdf', bytes: standardBase64.length },
    { type: 'text', label: 'user prompt (baseline clause text + instructions)' },
  ]
  if (manifest && manifestHasMarkup(manifest)) content.push({ type: 'text', label: 'ANNOTATION GROUND TRUTH block', chars: formatManifestForPrompt(manifest).length })
  console.log('\nACTUAL payload content blocks (as assembled by runContractReviewAi):')
  for (const c of content) console.log(' -', JSON.stringify(c))
  console.log('\nlocal manifest extraction:', manifestError ? `THREW: ${manifestError}` : manifest ? `struck=${manifest.struck.length} inserted=${manifest.inserted.length} unmapped=${manifest.unmapped.length} pages=${manifest.pages}` : 'null')

  const r = await prisma.contractReview.findUnique({ where: { id: 'fd97acb0-b84f-402c-b243-81fcb7f31f6b' }, select: { aiResponse: true } })
  const ai = r?.aiResponse as any
  console.log('\nstored analysis: changes=', ai?.changes?.length, '| summary:', String(ai?.summary || '').slice(0, 160))
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
