import { readFile } from 'fs/promises'
import { buildAnnotationManifest } from '../src/lib/contracts/annotationManifest'
async function main() {
  const buf = await readFile(process.env.SCRATCH + '/black-dog-redline.pdf')
  const m = await buildAnnotationManifest(buf)
  console.log(`struck=${m.struck.length} inserted=${m.inserted.length} unmapped=${m.unmapped.length} (expected 14/22/6 from the ef015a5a run)`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
