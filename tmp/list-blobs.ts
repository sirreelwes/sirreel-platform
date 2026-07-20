import { list } from '@vercel/blob'
async function main() {
  const res = await list({ prefix: 'contracts/2026/07/', limit: 100 })
  const sorted = res.blobs.sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt))
  for (const b of sorted.slice(0, 6)) console.log(b.uploadedAt, b.pathname, `${(b.size/1024).toFixed(0)}KB`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
