import { prisma } from '@/lib/prisma'
import { KNOWN_BROKERS, type KnownBroker } from '@/lib/coi/knownBrokers'
import { linkBrokerToCompany, normalizeBrokerFacts } from '@/lib/coi/brokerDirectory'
import { TaskRefused } from '@/lib/admin/taskRefused'

/**
 * Put the hand-named brokers (src/lib/coi/knownBrokers.ts) into the
 * directory. One implementation, two doors — /admin/maintenance and
 * `npx tsx scripts/seed-known-brokers.ts` — so the phone cannot lose
 * behaviour the laptop has (CLAUDE.md, 2026-09-16).
 *
 * Idempotent: matched on EMAIL, which is the directory's identity. A second
 * run fills blanks and re-reports; it never duplicates and never overwrites
 * a name someone has since corrected on the page.
 *
 * Refuses rather than 500s when the tables are not there — the fix line
 * names the task that creates them.
 */

export interface SeedKnownBrokersResult {
  log: string[]
  createdIds: string[]
  touchedIds: string[]
  warnings: string[]
  created: number
  updated: number
}

async function tablesExist(): Promise<boolean> {
  try {
    await prisma.broker.count()
    return true
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === 'P2021' || code === 'P2022') return false
    throw err
  }
}

export async function seedKnownBrokers(opts: { dryRun?: boolean } = {}): Promise<SeedKnownBrokersResult> {
  const dryRun = opts.dryRun !== false
  const log: string[] = []
  const warnings: string[] = []
  const createdIds: string[] = []
  const touchedIds: string[] = []
  let created = 0
  let updated = 0

  if (!(await tablesExist())) {
    throw new TaskRefused(
      'The broker directory tables are not in the database yet.',
      'Run "Create the broker directory tables" first (or npx tsx scripts/add-broker-tables.ts).',
    )
  }

  log.push(`${KNOWN_BROKERS.length} hand-named broker${KNOWN_BROKERS.length === 1 ? '' : 's'} to file.`, '')

  for (const b of KNOWN_BROKERS) {
    const facts = normalizeBrokerFacts(b)
    if (!facts) {
      warnings.push(`${b.email || '(no email)'} — not a usable email address; skipped.`)
      continue
    }

    // The client, when the hint resolves to exactly one company. Done BEFORE
    // the write so a dry run reports the same link a real run would make.
    let companyId: string | null = null
    if (b.companyNameHint) {
      const matches = await prisma.company.findMany({
        where: { name: { contains: b.companyNameHint, mode: 'insensitive' } },
        select: { id: true, name: true },
        take: 6,
      })
      if (matches.length === 1) {
        companyId = matches[0].id
        log.push(`  client: "${b.companyNameHint}" → ${matches[0].name}`)
      } else if (matches.length === 0) {
        warnings.push(
          `${facts.email} — no client matching "${b.companyNameHint}"; filed without one. ` +
            `The link forms itself the next time a certificate for them names her.`,
        )
      } else {
        warnings.push(
          `${facts.email} — "${b.companyNameHint}" matches ${matches.length} clients ` +
            `(${matches.map((m) => m.name).join(', ')}); filed without one rather than guessing.`,
        )
      }
    }

    const existing = await prisma.broker.findUnique({
      where: { email: facts.email },
      select: { id: true, name: true, agency: true, phone: true, notes: true },
    })

    if (existing) {
      // Fill blanks only. Someone may have corrected this row on the page
      // since it was seeded, and a re-run must not undo that.
      const data: Record<string, string> = {}
      if (!existing.name && facts.name) data.name = facts.name
      if (!existing.agency && facts.agency) data.agency = facts.agency
      if (!existing.phone && facts.phone) data.phone = facts.phone
      if (!existing.notes && b.notes) data.notes = b.notes
      const changes = Object.keys(data)
      log.push(
        changes.length
          ? `  ${facts.email} — already on file; ${dryRun ? 'would fill' : 'filled'} ${changes.join(', ')}.`
          : `  ${facts.email} — already on file, nothing to add.`,
      )
      if (changes.length && !dryRun) {
        await prisma.broker.update({ where: { id: existing.id }, data })
        updated += 1
      } else if (changes.length) {
        updated += 1
      }
      touchedIds.push(existing.id)
      if (companyId && !dryRun) {
        await linkBrokerToCompany({ brokerId: existing.id, companyId, source: 'MANUAL' })
      }
      continue
    }

    log.push(`  ${facts.email} — ${dryRun ? 'would add' : 'added'} ${facts.name ?? '(no name)'}.`)
    created += 1
    if (dryRun) continue

    const row = await prisma.broker.create({
      data: {
        email: facts.email,
        name: facts.name,
        agency: facts.agency,
        phone: facts.phone,
        notes: b.notes ?? null,
      },
      select: { id: true },
    })
    createdIds.push(row.id)
    if (companyId) {
      await linkBrokerToCompany({ brokerId: row.id, companyId, source: 'MANUAL' })
    }
  }

  return { log, createdIds, touchedIds, warnings, created, updated }
}

export type { KnownBroker }
