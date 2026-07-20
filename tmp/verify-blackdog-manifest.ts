import { readFile } from 'fs/promises'
import { buildAnnotationManifest } from '../src/lib/contracts/annotationManifest'
async function main() {
  const buf = await readFile(process.env.SCRATCH + '/blackdog-return.pdf')
  const m = await buildAnnotationManifest(buf)
  const byPage = new Map<number, number>()
  for (const s of m.struck) byPage.set(s.page, (byPage.get(s.page) ?? 0) + 1)
  console.log(`STRUCK: ${m.struck.length} | distribution:`, Object.fromEntries([...byPage].sort()))
  for (const s of m.struck) console.log(`  p${s.page} [${s.clauseGuess}] (${s.kind}): "${s.text}"`)
  console.log(`INSERTED: ${m.inserted.length}`)
  console.log(`UNMAPPED: ${m.unmapped.length}:`, m.unmapped.map(u => `p${u.page} ${u.kind}`).join(', '))
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
