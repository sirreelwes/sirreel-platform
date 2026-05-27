/**
 * One-off backfill: recompute mostCommonProductionTypeProfileId for
 * every Company. Idempotent. Run manually after Jobs start carrying
 * productionTypeProfileId values; running today sets every Company to
 * null because no Job has the FK populated yet.
 *
 * NOT wired into the booking flow per the brief — live maintenance
 * (re-running the helper after each Job create/update) lands in a
 * later commit.
 *
 * Run with:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx prisma/seeds/backfillCompanyMostCommonProductionTypeProfile.ts
 */
import { prisma } from '../../src/lib/prisma'
import { recomputeMostCommonProductionTypeProfile } from '../../src/lib/companies/recomputeMostCommonProductionTypeProfile'

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } })
  console.log(`Backfilling ${companies.length} companies...`)
  let withProfile = 0
  let withoutProfile = 0
  for (const c of companies) {
    const winner = await recomputeMostCommonProductionTypeProfile(c.id)
    if (winner) withProfile++
    else withoutProfile++
  }
  console.log(
    `Done: ${withProfile} companies got a most-common profile, ${withoutProfile} got null ` +
      `(no Jobs with productionTypeProfileId yet — expected until writers cut over).`,
  )
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
