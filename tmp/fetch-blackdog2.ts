import { get } from '@vercel/blob'
import { writeFile } from 'fs/promises'
async function main() {
  const blob = await get('contracts/2026/07/2a379b43-dd10-4ebc-b2fe-25757f490542.pdf', { access: 'private' })
  const chunks: Buffer[] = []
  for await (const c of blob!.stream as any) chunks.push(Buffer.from(c))
  await writeFile(process.env.SCRATCH + '/blackdog-return.pdf', Buffer.concat(chunks))
  console.log('saved', Buffer.concat(chunks).length)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
