import { readFile } from 'fs/promises'
import { buildAnnotationManifest } from '../src/lib/contracts/annotationManifest'

async function main() {
  const buf = await readFile(process.env.SCRATCH + '/black-dog-redline.pdf')
  const m = await buildAnnotationManifest(buf)
  console.log('pages:', m.pages)
  console.log('\nSTRUCK:')
  for (const s of m.struck) console.log(`  p${s.page} [${s.clauseGuess}] (${s.kind}): "${s.text}"`)
  console.log('\nINSERTED:')
  for (const n of m.inserted) console.log(`  p${n.page} [${n.clauseGuess}]: "${n.text.slice(0, 90)}"`)
  console.log('\nUNMAPPED:')
  for (const u of m.unmapped) console.log(`  p${u.page} ${u.kind}: ${u.note}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
