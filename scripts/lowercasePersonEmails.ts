/**
 * One-shot backfill: lowercase every Person.email that has any
 * uppercase character. After this runs, Person.email's @unique becomes
 * effectively case-insensitive in practice — no two values differ only
 * in case anymore.
 *
 * Idempotent. Re-running after lowercase is no-op.
 *
 * Collision handling: if lowercasing would collide with another
 * Person whose email is already the target lowercase value (the
 * known case — "Wes@" lowering to "wes@" while "wes@" already
 * exists), we DO NOT silently merge. We log the collision and skip,
 * because that merge has its own audited primitive
 * (src/lib/people/mergePersons.ts) and the merge UI is the right
 * surface for the decision.
 *
 * --apply to write. Dry-run by default.
 */
import { prisma } from '../src/lib/prisma'

const APPLY = process.argv.includes('--apply')

async function main() {
  // Pull every Person.email; check client-side whether lowercase
  // differs. (`mode: 'insensitive'` doesn't help here — we need the
  // raw value to test if it's mixed-case.)
  const all = await prisma.person.findMany({
    select: { id: true, email: true },
  })
  const candidates = all.filter((p) => p.email !== p.email.toLowerCase())
  console.log(`Total people: ${all.length}`)
  console.log(`Rows with mixed-case email: ${candidates.length}`)

  // Build a lowercase→id map to detect collisions.
  const lowerIndex = new Map<string, string>()
  for (const p of all) {
    const k = p.email.toLowerCase()
    // First occurrence wins (the row that's already lowercase, if any).
    if (!lowerIndex.has(k) || p.email === k) lowerIndex.set(k, p.id)
  }

  let lowered = 0
  let collisions = 0
  for (const p of candidates) {
    const target = p.email.toLowerCase()
    const owner = lowerIndex.get(target)
    if (owner && owner !== p.id) {
      console.log(`  collision  ${p.id.slice(0, 8)}…  "${p.email}" → "${target}"  already owned by ${owner.slice(0, 8)}…  (use merge UI)`)
      collisions++
      continue
    }
    console.log(`  lowercase  ${p.id.slice(0, 8)}…  "${p.email}" → "${target}"`)
    if (APPLY) {
      await prisma.person.update({ where: { id: p.id }, data: { email: target } })
    }
    lowered++
  }

  console.log()
  console.log(`Lowercased:        ${lowered}`)
  console.log(`Collisions skipped: ${collisions}  (resolve via merge UI)`)
  if (!APPLY) console.log('\n(dry-run — pass --apply to write)')
}

main().finally(() => prisma.$disconnect())
