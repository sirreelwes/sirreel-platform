#!/usr/bin/env tsx
/**
 * Merge the four duplicate Crazy Maple / CMS Company rows into one.
 *
 * Background (2026-08-29, Wes):
 *   Quoting "God of Wrath & Ruin" surfaced four separate Company rows for
 *   the same client. Only one carries the RentalWorks link and therefore
 *   the spend history; the other three carry all the HQ-native rows:
 *
 *     KEEPER  d271ef71  CMS Media Inc / Crazy Maple Studios / ReelShort
 *             STANDARD, $52,387.22 / 30 bookings, rwCustomerId A0006RG9
 *             attached: 1 incident
 *     DUP     2593fcbb  CMS Picture Inc.        7 affiliations, 1 booking,
 *                                               1 job, 13 inquiry captures
 *     DUP     65f8e1ee  Crazy Maple Studios     1 affiliation, 1 booking, 1 job
 *     DUP     cce4d6d5  Crazy Maple Studio      8 affiliations, 1 booking, 1 job
 *
 *   Consequence: no client-level fact (standing vehicle discount, COI,
 *   negotiated terms, spend) can land in a place all four quotes will see.
 *
 * What this does:
 *   1. Repoints every Company FK on the three duplicates to the keeper.
 *      The FK list is derived from the Prisma DMMF at runtime, not
 *      hand-maintained — a new Company relation added later is picked up
 *      automatically instead of being silently skipped.
 *   2. Affiliation is the one table with a unique constraint that a
 *      repoint can violate: @@unique([personId, companyId, productionName]).
 *      Six people are affiliated to two duplicates each (all with
 *      productionName = null), so those pairs collapse. The richer row
 *      wins (roleOnShow / notes / dates / spend, then oldest); the loser
 *      is deleted and its full body journalled.
 *   3. Backfills keeper fields that are null from the duplicates
 *      (never overwrites a value the keeper already has) and appends a
 *      merge note.
 *   4. Deletes the three duplicate Company rows. Any FK this script
 *      failed to move makes the delete throw — that is the safety net,
 *      not an accident.
 *   5. Writes an AuditLog row per merged company (action `company.merge`)
 *      carrying the full pre-merge body.
 *
 *   Name is NOT changed — "CMS Media Inc / Crazy Maple Studios / ReelShort"
 *   already reads as the alias list. Rename in the CRM if Wes wants.
 *
 *   Company.totalSpend / totalBookings / lastRentalAt are a CACHE of the
 *   RW invoice mirror keyed on rentalworksCustomerId; the duplicates have
 *   no RW id and contribute nothing, so no re-rollup is required.
 *
 * Usage:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/merge-cms-companies.ts            # dry run
 *   npx tsx scripts/merge-cms-companies.ts --write    # commit
 *
 * Reverse: tmp/cms-company-merge-<ts>.json holds every duplicate Company
 *   body, every moved row id per model, and every deleted Affiliation
 *   body. Recreate the Company rows with their original ids, then move
 *   the captured ids back. Reversal is BY CAPTURED ID only.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { writeFileSync, mkdirSync } from 'node:fs'

const KEEPER_ID = 'd271ef71-8261-48c1-b3c6-79b0939b9153'
const DUP_IDS = [
  '2593fcbb-8bb2-4bd2-8d6f-2c876d37f52e', // CMS Picture Inc.
  '65f8e1ee-c571-48d4-b3e3-ac369f04124f', // Crazy Maple Studios
  'cce4d6d5-6a9c-44bb-b8d3-4d3b6eab6c5d', // Crazy Maple Studio
]

const WRITE = process.argv.includes('--write')

/** Every model with a scalar FK to Company, straight from the DMMF. */
function companyFkModels(): { model: string; delegate: string; fk: string }[] {
  const out: { model: string; delegate: string; fk: string }[] = []
  for (const m of Prisma.dmmf.datamodel.models) {
    for (const f of m.fields) {
      if (f.kind === 'object' && f.type === 'Company' && f.relationFromFields?.length) {
        out.push({
          model: m.name,
          delegate: m.name[0].toLowerCase() + m.name.slice(1),
          fk: f.relationFromFields[0],
        })
      }
    }
  }
  return out
}

/** Richer Affiliation wins a (personId, productionName) collision. */
function affScore(a: {
  roleOnShow: unknown; notes: unknown; startDate: unknown; endDate: unknown
  totalSpend: Prisma.Decimal; totalBookings: number
}): number {
  return (a.roleOnShow ? 8 : 0) + (a.notes ? 4 : 0) + (a.startDate ? 2 : 0) +
    (a.endDate ? 1 : 0) + (a.totalSpend.greaterThan(0) ? 16 : 0) + (a.totalBookings > 0 ? 16 : 0)
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  console.log(`CMS / Crazy Maple company merge — ${WRITE ? 'LIVE WRITE' : 'DRY RUN (pass --write to apply)'}\n`)

  const companies = await prisma.company.findMany({ where: { id: { in: [KEEPER_ID, ...DUP_IDS] } } })
  const keeper = companies.find((c) => c.id === KEEPER_ID)
  if (!keeper) throw new Error(`Keeper ${KEEPER_ID} not found — refusing to merge.`)
  const dups = DUP_IDS.map((id) => {
    const c = companies.find((x) => x.id === id)
    if (!c) throw new Error(`Duplicate ${id} not found — refusing to merge a stale id list.`)
    return c
  })
  console.log(`KEEPER  ${keeper.id}  ${keeper.name}  (${keeper.tier}, rw=${keeper.rentalworksCustomerId ?? '—'})`)
  for (const d of dups) console.log(`DUP     ${d.id}  ${d.name}`)
  console.log('')

  const models = companyFkModels()

  // ── Affiliation collision plan ────────────────────────────────────
  const affs = await prisma.affiliation.findMany({
    where: { companyId: { in: [KEEPER_ID, ...DUP_IDS] } },
    include: { person: { select: { firstName: true, lastName: true, email: true } } },
  })
  const byKey = new Map<string, typeof affs>()
  for (const a of affs) {
    const k = `${a.personId}|${a.productionName ?? ''}`
    byKey.set(k, [...(byKey.get(k) ?? []), a])
  }
  const affKeepIds: string[] = []
  const affDropIds: string[] = []
  const affDropBodies: unknown[] = []
  for (const [, rows] of byKey) {
    if (rows.length === 1) { affKeepIds.push(rows[0].id); continue }
    const ranked = [...rows].sort((a, b) => {
      // Keeper-owned row always wins so we never delete a pre-existing link.
      if ((a.companyId === KEEPER_ID) !== (b.companyId === KEEPER_ID)) return a.companyId === KEEPER_ID ? -1 : 1
      const d = affScore(b) - affScore(a)
      if (d !== 0) return d
      return a.createdAt.getTime() - b.createdAt.getTime()
    })
    affKeepIds.push(ranked[0].id)
    for (const loser of ranked.slice(1)) {
      affDropIds.push(loser.id)
      affDropBodies.push(loser)
      console.log(`  affiliation collision: ${ranked[0].person.firstName} ${ranked[0].person.lastName} ` +
        `<${ranked[0].person.email ?? '—'}> — keep ${ranked[0].id.slice(0, 8)} (${ranked[0].companyId.slice(0, 8)}), ` +
        `drop ${loser.id.slice(0, 8)} (${loser.companyId.slice(0, 8)})`)
    }
  }
  console.log(`  → ${affs.length} affiliations in, ${affKeepIds.length} out, ${affDropIds.length} dropped as duplicates\n`)

  // ── Capture every row id that will move, per model ────────────────
  const moves: Record<string, string[]> = {}
  for (const m of models) {
    const rows = await (prisma as any)[m.delegate].findMany({
      where: { [m.fk]: { in: DUP_IDS } },
      select: { id: true },
    })
    if (rows.length) moves[m.model] = rows.map((r: { id: string }) => r.id)
  }
  // Affiliations that lose their collision are deleted, not moved.
  if (moves.Affiliation) moves.Affiliation = moves.Affiliation.filter((id) => !affDropIds.includes(id))

  console.log('ROWS TO REPOINT ONTO THE KEEPER')
  for (const [model, ids] of Object.entries(moves)) console.log(`  ${model.padEnd(18)} ${ids.length}`)
  if (!Object.keys(moves).length) console.log('  (none)')
  console.log('')

  // ── Keeper field backfill — fills nulls only ──────────────────────
  const BACKFILLABLE = [
    'website', 'insuranceCarrier', 'insurancePolicyNum', 'insuranceContact', 'coiDocumentUrl',
    'rentalworksCustomerId', 'billingEmail', 'billingAddress', 'typicalDiscountPct', 'discountNotes',
    'defaultAgentId', 'mostCommonProductionTypeProfileId',
  ] as const
  const backfill: Record<string, unknown> = {}
  for (const field of BACKFILLABLE) {
    if ((keeper as any)[field] != null && (keeper as any)[field] !== '') continue
    const donor = dups.find((d) => (d as any)[field] != null && (d as any)[field] !== '')
    if (donor) backfill[field] = (donor as any)[field]
  }
  const mergeNote = `Merged ${dups.length} duplicate company records on ${stamp.slice(0, 10)}: ` +
    dups.map((d) => `${d.name} (${d.id})`).join('; ') + '.'
  backfill.notes = keeper.notes ? `${keeper.notes}\n\n${mergeNote}` : mergeNote

  console.log('KEEPER BACKFILL')
  for (const [k, v] of Object.entries(backfill)) console.log(`  ${k} = ${String(v).slice(0, 90)}`)
  console.log('')

  const journal = {
    ranAt: new Date().toISOString(),
    mode: WRITE ? 'write' : 'dry-run',
    keeperId: KEEPER_ID,
    keeperBefore: keeper,
    duplicates: dups,
    moves,
    affiliationsDeleted: affDropBodies,
    backfill,
  }
  mkdirSync('tmp', { recursive: true })
  const journalPath = `tmp/cms-company-merge-${stamp}.json`
  writeFileSync(journalPath, JSON.stringify(journal, null, 2))
  console.log(`journal → ${journalPath}`)

  if (!WRITE) {
    console.log('\nDRY RUN — nothing written.')
    return
  }

  await prisma.$transaction(async (tx) => {
    if (affDropIds.length) {
      await tx.affiliation.deleteMany({ where: { id: { in: affDropIds } } })
    }
    for (const [model, ids] of Object.entries(moves)) {
      const m = models.find((x) => x.model === model)!
      await (tx as any)[m.delegate].updateMany({
        where: { id: { in: ids } },
        data: { [m.fk]: KEEPER_ID },
      })
    }
    await tx.company.update({ where: { id: KEEPER_ID }, data: backfill as never })
    for (const d of dups) {
      await tx.auditLog.create({
        data: {
          userId: null,
          action: 'company.merge',
          entityType: 'Company',
          entityId: d.id,
          oldValues: JSON.parse(JSON.stringify(d)),
          newValues: { mergedIntoId: KEEPER_ID, journal: journalPath },
        },
      })
      await tx.company.delete({ where: { id: d.id } })
    }
  }, { timeout: 60_000 })

  const after = await prisma.company.findMany({ where: { id: { in: [KEEPER_ID, ...DUP_IDS] } }, select: { id: true, name: true } })
  console.log(`\nDONE. Company rows remaining for this client: ${after.length}`)
  for (const c of after) console.log(`  ${c.id}  ${c.name}`)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
