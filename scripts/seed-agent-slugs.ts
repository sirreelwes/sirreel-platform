/**
 * Seed `User.publicSlug` for every active AGENT that doesn't already
 * have one. Used by the agent-shareable intake link feature
 * (/intake/<slug>).
 *
 * Algorithm — assign in stable order (oldest createdAt first) so the
 * earliest-onboarded agent gets the shorter form on collision:
 *
 *   1. Compute candidate = lowercase(firstName-first-word, [a-z0-9]).
 *   2. If candidate is free, take it.
 *   3. Else append lastName's first letter (lowercase). If free, take.
 *   4. Else append digits 2, 3, 4… until free.
 *
 * Never overwrites an existing non-null slug. Idempotent — re-running
 * is a no-op once every active AGENT has a slug.
 *
 * Run once after deploying the schema migration:
 *   export DATABASE_URL=...
 *   npx tsx scripts/seed-agent-slugs.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function baseSlug(name: string): string {
  // First whitespace-separated token, lowercased, only [a-z0-9].
  const first = name.trim().split(/\s+/)[0] ?? ''
  return first.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function lastInitial(name: string): string {
  const parts = name.trim().split(/\s+/)
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  return last.charAt(0).toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function isTaken(slug: string, excludeUserId: string): Promise<boolean> {
  const existing = await prisma.user.findFirst({
    where: { publicSlug: slug, NOT: { id: excludeUserId } },
    select: { id: true },
  })
  return !!existing
}

async function pickSlug(user: { id: string; name: string }): Promise<string | null> {
  const base = baseSlug(user.name)
  if (!base) return null
  if (!(await isTaken(base, user.id))) return base

  const li = lastInitial(user.name)
  if (li) {
    const withInitial = `${base}${li}`
    if (!(await isTaken(withInitial, user.id))) return withInitial
  }

  for (let n = 2; n < 100; n++) {
    const candidate = `${base}${n}`
    if (!(await isTaken(candidate, user.id))) return candidate
  }
  return null
}

async function main() {
  const agents = await prisma.user.findMany({
    where: { role: 'AGENT', isActive: true },
    select: { id: true, name: true, publicSlug: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  const assigned: Array<{ id: string; name: string; slug: string }> = []
  const kept: Array<{ id: string; name: string; slug: string }> = []
  const skipped: Array<{ id: string; name: string; reason: string }> = []

  for (const u of agents) {
    if (u.publicSlug) {
      kept.push({ id: u.id, name: u.name, slug: u.publicSlug })
      continue
    }
    const slug = await pickSlug(u)
    if (!slug) {
      skipped.push({ id: u.id, name: u.name, reason: 'no usable slug (empty/non-ASCII name?)' })
      continue
    }
    await prisma.user.update({ where: { id: u.id }, data: { publicSlug: slug } })
    assigned.push({ id: u.id, name: u.name, slug })
  }

  console.log(JSON.stringify({
    totalActiveAgents: agents.length,
    assignedThisRun: assigned,
    alreadyHadSlug: kept,
    skipped,
  }, null, 2))
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
