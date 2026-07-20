import { get } from '@vercel/blob'
import { writeFile } from 'fs/promises'

async function main() {
  const key = 'contracts/2026/07/c762362d-f7af-412d-b6f3-2e133047f307.pdf'
  const blob = await get(key, { access: 'private' })
  if (!blob || blob.statusCode !== 200 || !blob.stream) throw new Error('blob fetch failed: ' + blob?.statusCode)
  const chunks: Buffer[] = []
  for await (const c of blob.stream as any) chunks.push(Buffer.from(c))
  const buf = Buffer.concat(chunks)
  const out = process.env.SCRATCH + '/black-dog-redline.pdf'
  await writeFile(out, buf)
  console.log('saved', out, buf.length, 'bytes')
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
