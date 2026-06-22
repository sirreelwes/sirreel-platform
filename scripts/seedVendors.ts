/**
 * One-shot seed for the common reorder vendors. Idempotent via upsert
 * on `name` (which is @unique). Safe to re-run.
 *
 *   tsx scripts/seedVendors.ts
 */

import { prisma } from '../src/lib/prisma'

const SEED = [
  { name: 'Amazon', website: 'https://www.amazon.com' },
  { name: 'Home Depot', website: 'https://www.homedepot.com' },
]

async function main() {
  for (const v of SEED) {
    const result = await prisma.vendor.upsert({
      where: { name: v.name },
      update: {},
      create: { name: v.name, website: v.website },
    })
    console.log(`✓ ${result.name} (${result.id})`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
