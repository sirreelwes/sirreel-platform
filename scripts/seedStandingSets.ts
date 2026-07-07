/**
 * Seed the 4 starter STANDING_SET spaces as UNPUBLISHED skeleton rows for
 * Wes to fill in (photos + real descriptions) and publish. Idempotent via
 * upsert on the (type, name) unique key — safe to re-run; it will NOT
 * overwrite a description Wes has already edited (update: {}).
 *
 *   tsx scripts/seedStandingSets.ts
 *
 * Descriptions are deliberately a short TODO placeholder — real marketing
 * copy is Wes's to write, not invented here.
 */

import { prisma } from '../src/lib/prisma'

const PLACEHOLDER = 'TODO: add description.'

const SEED = ['Hospital', 'Police Station', 'Jail', 'Morgue']

async function main() {
  let order = 0
  for (const name of SEED) {
    const result = await prisma.space.upsert({
      where: { type_name: { type: 'STANDING_SET', name } },
      update: {}, // never clobber Wes's edits on re-run
      create: {
        name,
        type: 'STANDING_SET',
        description: PLACEHOLDER,
        sortOrder: order,
        published: false, // stays hidden until Wes uploads a photo + publishes
      },
    })
    console.log(`✓ ${result.name} (${result.id}) published=${result.published}`)
    order += 1
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
