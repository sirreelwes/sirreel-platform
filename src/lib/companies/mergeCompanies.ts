/**
 * Company merge — the primitive behind BOTH the CRM merge button and
 * scripts/merge-companies.ts. One implementation, so the thing Wes can
 * fire from a company page is the same thing that has been run by hand
 * since the Crazy Maple merge (2026-08-29).
 *
 * The rules that matter, unchanged from the script:
 *
 *   1. Every Company foreign key is derived from the Prisma DMMF at
 *      RUNTIME, never hand-maintained. A Company relation added next
 *      month is picked up automatically instead of silently stranding
 *      rows — which is exactly what the naive 3-table merge in
 *      /api/crm/find-duplicates did (it moved Order / Affiliation /
 *      Activity and left bookings, COIs, cards and jobs behind).
 *   2. Affiliation is the one table whose unique key a repoint can
 *      violate (@@unique([personId, companyId, productionName])).
 *      Colliding rows collapse: a row already on the KEEPER always
 *      wins, otherwise the richer one does. Losers are deleted and
 *      their bodies captured for reversal.
 *   3. Keeper fields are backfilled ONLY where the keeper is null. A
 *      value the keeper already has is never overwritten, and the
 *      keeper's NAME is never touched (rename in the CRM if wanted).
 *   4. The duplicate rows are deleted last, and only after a re-count
 *      proves nothing still points at them. That check is the safety
 *      net — NOT the foreign key error, which several Company relations
 *      do not raise: CompanyCard, CompanyRate, CompanyAgreement and
 *      CompanyPortalAccess are `onDelete: Cascade`, so a duplicate
 *      deleted with rows still on it takes the client's cards, rates,
 *      agreements and portal logins with it, silently. (That is exactly
 *      what the old /api/crm/find-duplicates merge did: it moved three
 *      tables and deleted the row.) The DMMF sweep is what keeps this
 *      whole, and the re-count is what proves the sweep worked.
 *   5. One AuditLog row per merged company (action `company.merge`)
 *      carrying the full pre-merge body in oldValues and, in
 *      newValues, every moved row id per model. That payload alone is
 *      enough to reverse the merge BY CAPTURED ID, with no journal
 *      file — which is what makes this safe to run on Vercel, where
 *      there is no writable filesystem.
 *
 * Company.totalSpend / totalBookings / lastRentalAt are a CACHE of the
 * RW invoice mirror keyed on rentalworksCustomerId. A duplicate with no
 * RW id contributes nothing; if a duplicate HAS one, re-run
 * scripts/rollupCompanySpend.ts after merging.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { companyNameKey } from '@/lib/companies/normalize'

// ── Foreign-key discovery ────────────────────────────────────────────

export interface CompanyFkModel {
  /** Prisma model name, e.g. "Booking". */
  model: string
  /** Client delegate, e.g. "booking". */
  delegate: string
  /** Scalar FK column on that model, e.g. "companyId". */
  fk: string
}

/** Every model with a scalar FK to Company, straight from the DMMF. */
export function companyFkModels(): CompanyFkModel[] {
  const out: CompanyFkModel[] = []
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

// ── Affiliation collisions ───────────────────────────────────────────

/** Decimal, number, or anything with toNumber() — Prisma gives us the first. */
type Numeric = number | { toNumber(): number }

const num = (v: Numeric | null | undefined): number =>
  v == null ? 0 : typeof v === 'number' ? v : v.toNumber()

export interface AffiliationForMerge {
  id: string
  personId: string
  companyId: string
  productionName: string | null
  roleOnShow: string | null
  notes: string | null
  startDate: Date | null
  endDate: Date | null
  totalSpend: Numeric
  totalBookings: number
  createdAt: Date
}

/** Richer Affiliation wins a (personId, productionName) collision. */
export function affiliationScore(a: AffiliationForMerge): number {
  return (a.roleOnShow ? 8 : 0) + (a.notes ? 4 : 0) + (a.startDate ? 2 : 0) +
    (a.endDate ? 1 : 0) + (num(a.totalSpend) > 0 ? 16 : 0) + (a.totalBookings > 0 ? 16 : 0)
}

export interface AffiliationCollisionPlan {
  /** Rows that survive (one per personId+productionName). */
  keepIds: string[]
  /** Rows deleted rather than repointed, because repointing would
   *  violate the unique key. */
  dropIds: string[]
}

/**
 * Decide which Affiliation rows survive a repoint onto `keeperId`.
 * Pass every affiliation on the keeper AND the duplicates.
 */
export function planAffiliationCollisions(
  rows: AffiliationForMerge[],
  keeperId: string,
): AffiliationCollisionPlan {
  const byKey = new Map<string, AffiliationForMerge[]>()
  for (const a of rows) {
    const k = `${a.personId}|${a.productionName ?? ''}`
    byKey.set(k, [...(byKey.get(k) ?? []), a])
  }
  const keepIds: string[] = []
  const dropIds: string[] = []
  for (const [, group] of byKey) {
    if (group.length === 1) { keepIds.push(group[0].id); continue }
    const ranked = [...group].sort((a, b) => {
      // Keeper-owned row always wins so we never delete a pre-existing link.
      if ((a.companyId === keeperId) !== (b.companyId === keeperId)) {
        return a.companyId === keeperId ? -1 : 1
      }
      const d = affiliationScore(b) - affiliationScore(a)
      if (d !== 0) return d
      return a.createdAt.getTime() - b.createdAt.getTime()
    })
    keepIds.push(ranked[0].id)
    for (const loser of ranked.slice(1)) dropIds.push(loser.id)
  }
  return { keepIds, dropIds }
}

// ── Keeper backfill ──────────────────────────────────────────────────

/** Fields a duplicate may donate to a keeper that has none. NOT `name`. */
export const BACKFILLABLE_FIELDS = [
  'website', 'insuranceCarrier', 'insurancePolicyNum', 'insuranceContact', 'coiDocumentUrl',
  'rentalworksCustomerId', 'billingEmail', 'billingAddress', 'typicalDiscountPct', 'discountNotes',
  'defaultAgentId', 'mostCommonProductionTypeProfileId',
] as const

type Companyish = Record<string, unknown> & { id: string; name: string; notes?: string | null }

/**
 * Fills keeper nulls from the duplicates and appends the merge note.
 * Never overwrites a value the keeper already has.
 */
export function planBackfill(
  keeper: Companyish,
  duplicates: Companyish[],
  isoDay: string,
): Record<string, unknown> {
  const backfill: Record<string, unknown> = {}
  for (const field of BACKFILLABLE_FIELDS) {
    const held = keeper[field]
    if (held != null && held !== '') continue
    const donor = duplicates.find((d) => d[field] != null && d[field] !== '')
    if (donor) backfill[field] = donor[field]
  }
  const mergeNote = `Merged ${duplicates.length} duplicate company records on ${isoDay}: ` +
    duplicates.map((d) => `${d.name} (${d.id})`).join('; ') + '.'
  backfill.notes = keeper.notes ? `${keeper.notes}\n\n${mergeNote}` : mergeNote
  return backfill
}

// ── Near-duplicate suggestion ────────────────────────────────────────

/**
 * A LOOSER key than companyNameKey, for SUGGESTING merge candidates in
 * the picker — never for deciding anything.
 *
 * companyNameKey is the create-time dupe guard and is deliberately
 * strict: it folds legal and industry suffixes but nothing else, so
 * "High Horse" and "High Horses" are different companies to it. That is
 * the right call at create time (refusing a real new client is worse
 * than admitting a near-twin) and it is why the 2026-09-18 High Horse /
 * High Horses pair was created at all. Here the stakes are reversed —
 * this only decides which rows are OFFERED to a human — so plural
 * forms fold together.
 */
export function nearDuplicateKey(raw: string | null | undefined): string {
  if (!raw) return ''
  // The fold runs BEFORE companyNameKey, not after. Folding afterwards
  // looks equivalent and isn't: companyNameKey strips a list of generic
  // suffixes that contains "pictures" but not "picture", so
  // "CMS Pictures" reduced to "cms" while "CMS Picture Inc." stopped at
  // "cms picture" and the two never met. Singularizing first puts both
  // names into the same vocabulary before any suffix stripping happens.
  const singular = String(raw).replace(/[A-Za-z0-9']+/g, foldPlural)
  return companyNameKey(singular).split(' ').map(foldPlural).join(' ')
}

/** "horses" → "horse". Short words and "ss" endings are left alone. */
function foldPlural(word: string): string {
  const w = word.toLowerCase()
  return w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? word.slice(0, -1) : word
}

/** True when two names are close enough to offer as a merge candidate. */
export function isNearDuplicateName(a: string, b: string): boolean {
  const ka = nearDuplicateKey(a)
  const kb = nearDuplicateKey(b)
  if (!ka || !kb) return false
  return ka === kb
}

// ── The plan ─────────────────────────────────────────────────────────

export interface CompanyMergePlan {
  keeper: Record<string, unknown> & { id: string; name: string }
  duplicates: (Record<string, unknown> & { id: string; name: string })[]
  /** model → row ids to repoint, across all duplicates. */
  moves: Record<string, string[]>
  /** duplicate id → model → row ids, for per-company audit rows. */
  movesByDuplicate: Record<string, Record<string, string[]>>
  /** Full bodies of the Affiliation rows that will be DELETED. */
  affiliationsDeleted: AffiliationForMerge[]
  backfill: Record<string, unknown>
  /** model → count, for the UI. */
  counts: { model: string; rows: number }[]
  totalRows: number
}

/**
 * Read-only. Everything the merge would do, with no writes — the dry
 * run and the UI preview are the same call.
 */
export async function planCompanyMerge(args: {
  keeperId: string
  duplicateIds: string[]
}): Promise<CompanyMergePlan> {
  const { keeperId } = args
  const duplicateIds = [...new Set(args.duplicateIds)]
  if (!duplicateIds.length) throw new Error('No duplicate ids given — nothing to merge.')
  if (duplicateIds.includes(keeperId)) throw new Error('The keeper cannot also be a duplicate.')

  const companies = await prisma.company.findMany({ where: { id: { in: [keeperId, ...duplicateIds] } } })
  const keeper = companies.find((c) => c.id === keeperId)
  if (!keeper) throw new Error(`Keeper ${keeperId} not found — refusing to merge.`)
  const duplicates = duplicateIds.map((id) => {
    const c = companies.find((x) => x.id === id)
    if (!c) throw new Error(`Duplicate ${id} not found — refusing to merge a stale id list.`)
    return c
  })

  // Affiliation collision plan — keeper's own rows included, since a
  // collision is only visible when both sides are in the picture.
  const affs = await prisma.affiliation.findMany({
    where: { companyId: { in: [keeperId, ...duplicateIds] } },
  })
  const { dropIds } = planAffiliationCollisions(affs as AffiliationForMerge[], keeperId)
  const dropSet = new Set(dropIds)
  const affiliationsDeleted = (affs as AffiliationForMerge[]).filter((a) => dropSet.has(a.id))

  // Capture every row id that will move, per model AND per duplicate.
  const moves: Record<string, string[]> = {}
  const movesByDuplicate: Record<string, Record<string, string[]>> = {}
  for (const id of duplicateIds) movesByDuplicate[id] = {}

  for (const m of companyFkModels()) {
    const rows = (await (prisma as unknown as Record<string, {
      findMany(a: unknown): Promise<Record<string, string>[]>
    }>)[m.delegate].findMany({
      where: { [m.fk]: { in: duplicateIds } },
      select: { id: true, [m.fk]: true },
    })).filter((r) => !(m.model === 'Affiliation' && dropSet.has(r.id)))
    if (!rows.length) continue
    moves[m.model] = rows.map((r) => r.id)
    for (const r of rows) {
      const owner = r[m.fk]
      ;(movesByDuplicate[owner][m.model] ??= []).push(r.id)
    }
  }

  const isoDay = new Date().toISOString().slice(0, 10)
  const counts = Object.entries(moves)
    .map(([model, ids]) => ({ model, rows: ids.length }))
    .sort((a, b) => b.rows - a.rows || a.model.localeCompare(b.model))

  return {
    keeper,
    duplicates,
    moves,
    movesByDuplicate,
    affiliationsDeleted,
    backfill: planBackfill(keeper as Companyish, duplicates as Companyish[], isoDay),
    counts,
    totalRows: counts.reduce((s, c) => s + c.rows, 0),
  }
}

export interface CompanyMergeResult {
  keeperId: string
  keeperName: string
  mergedIds: string[]
  movedRows: number
  affiliationsDeleted: number
  auditLogIds: string[]
}

/**
 * Applies a plan in one transaction. Re-plan immediately before calling
 * this — never apply a plan built from client-supplied data.
 *
 * @param journalPath  set by the CLI, which also writes a journal file.
 *                     The UI passes nothing: its reversal payload lives
 *                     entirely in the AuditLog row.
 */
export async function applyCompanyMerge(args: {
  plan: CompanyMergePlan
  mergedById: string | null
  via: 'crm-ui' | 'script'
  journalPath?: string | null
}): Promise<CompanyMergeResult> {
  const { plan, mergedById, via, journalPath = null } = args
  const models = companyFkModels()
  const auditLogIds: string[] = []

  await prisma.$transaction(async (tx) => {
    const t = tx as unknown as Record<string, {
      updateMany(a: unknown): Promise<unknown>
      count(a: unknown): Promise<number>
    }>

    if (plan.affiliationsDeleted.length) {
      await tx.affiliation.deleteMany({
        where: { id: { in: plan.affiliationsDeleted.map((a) => a.id) } },
      })
    }
    for (const [model, ids] of Object.entries(plan.moves)) {
      const m = models.find((x) => x.model === model)
      if (!m) throw new Error(`No Company FK found for model ${model} — refusing to merge.`)
      await t[m.delegate].updateMany({
        where: { id: { in: ids } },
        data: { [m.fk]: plan.keeper.id },
      })
    }
    await tx.company.update({ where: { id: plan.keeper.id }, data: plan.backfill as never })

    // Nothing may still point at a company we are about to delete. Four
    // Company relations cascade, so an unmoved row would be destroyed
    // instead of blocking the delete — this is the check that stands in
    // for the foreign key error we cannot rely on.
    const duplicateIds = plan.duplicates.map((d) => d.id)
    for (const m of models) {
      const left = await t[m.delegate].count({ where: { [m.fk]: { in: duplicateIds } } })
      if (left > 0) {
        throw new Error(
          `Refusing to delete: ${left} ${m.model} row(s) still point at the duplicate. ` +
          'Nothing has been written.',
        )
      }
    }

    for (const d of plan.duplicates) {
      const row = await tx.auditLog.create({
        data: {
          userId: mergedById,
          action: 'company.merge',
          entityType: 'Company',
          entityId: d.id,
          oldValues: JSON.parse(JSON.stringify(d)),
          newValues: JSON.parse(JSON.stringify({
            mergedIntoId: plan.keeper.id,
            mergedIntoName: plan.keeper.name,
            via,
            journal: journalPath,
            // Reversal material: every row this merge moved off THIS
            // company, plus the affiliations it deleted outright.
            movedRows: plan.movesByDuplicate[d.id] ?? {},
            affiliationsDeleted: plan.affiliationsDeleted.filter((a) => a.companyId === d.id),
            backfill: plan.backfill,
          })),
        },
        select: { id: true },
      })
      auditLogIds.push(row.id)
      // Throws if anything still points here — the safety net.
      await tx.company.delete({ where: { id: d.id } })
    }
  }, { timeout: 60_000 })

  return {
    keeperId: plan.keeper.id,
    keeperName: plan.keeper.name,
    mergedIds: plan.duplicates.map((d) => d.id),
    movedRows: plan.totalRows,
    affiliationsDeleted: plan.affiliationsDeleted.length,
    auditLogIds,
  }
}
