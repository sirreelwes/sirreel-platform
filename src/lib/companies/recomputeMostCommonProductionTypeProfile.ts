import { prisma } from '@/lib/prisma'

/**
 * Recomputes the mode of productionTypeProfileId across this Company's
 * Jobs and caches the winner on Company.mostCommonProductionTypeProfileId.
 *
 * - Considers ONLY Jobs that have a productionTypeProfileId set.
 *   Jobs with null (the default state until the new-quote flow starts
 *   writing the FK) are excluded — they shouldn't drag the mode
 *   toward null.
 * - Tie-break: most-recently-touched profile wins. A tie on count
 *   biases toward what the company is doing most recently, which is
 *   the more useful default-routing signal than "first ever recorded."
 * - Returns the resolved id (or null if the company has zero
 *   profile-tagged Jobs).
 * - Idempotent — safe to re-run.
 *
 * NOT called from the Job create/update flow yet. The backfill script
 * (prisma/seeds/backfillCompanyMostCommonProductionTypeProfile.ts) runs
 * this for every Company on demand; live maintenance lands in a later
 * commit.
 */
export async function recomputeMostCommonProductionTypeProfile(
  companyId: string,
): Promise<string | null> {
  const jobs = await prisma.job.findMany({
    where: { companyId, productionTypeProfileId: { not: null } },
    select: { productionTypeProfileId: true, updatedAt: true },
  })

  if (jobs.length === 0) {
    await prisma.company.update({
      where: { id: companyId },
      data: { mostCommonProductionTypeProfileId: null },
    })
    return null
  }

  // Count occurrences + track the most-recent updatedAt per profile.
  const stats = new Map<string, { count: number; lastSeen: number }>()
  for (const job of jobs) {
    const id = job.productionTypeProfileId
    if (!id) continue
    const seen = job.updatedAt.getTime()
    const cur = stats.get(id)
    if (cur) {
      cur.count++
      if (seen > cur.lastSeen) cur.lastSeen = seen
    } else {
      stats.set(id, { count: 1, lastSeen: seen })
    }
  }

  // Pick highest count; tie-break by most-recent lastSeen.
  let winner: string | null = null
  let bestCount = -1
  let bestRecent = -1
  for (const [id, { count, lastSeen }] of stats) {
    if (count > bestCount || (count === bestCount && lastSeen > bestRecent)) {
      winner = id
      bestCount = count
      bestRecent = lastSeen
    }
  }

  await prisma.company.update({
    where: { id: companyId },
    data: { mostCommonProductionTypeProfileId: winner },
  })
  return winner
}
