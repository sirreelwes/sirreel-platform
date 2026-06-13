/**
 * mergePersons — the audited, reversible Person merge primitive.
 *
 * Hard rules (no exceptions):
 *   - Every repoint runs inside a single `prisma.$transaction`. Partial
 *     state is impossible — either the merge fully lands or the DB is
 *     untouched and the caller gets the throw.
 *   - The PersonMerge audit row is written INSIDE the same transaction,
 *     not after. A merge without a reversal log is a merge that can't
 *     be undone, which is worse than not merging.
 *   - The loser Person row is hard-deleted at the end of the
 *     transaction. There is no `Person.isActive=false` half-state —
 *     that would leave a phantom in every search surface. The loser's
 *     full row snapshot lives on PersonMerge.loserSnapshot.
 *   - User.personId is @unique. If both survivor AND loser have a User
 *     row pointing at them, we ABORT — that's two real portal accounts
 *     for one human, needs human triage, not silent merge.
 *
 * Audit contract:
 *   PersonMerge.repointLog is the per-FK transcript. Each entry has
 *   enough information that reverseMerge can undo it without consulting
 *   the survivor: which rows moved, which collided and were deleted,
 *   which numeric columns were summed.
 *
 * Email handling:
 *   - The survivor's email is normalized to lowercase as part of the
 *     merge (root cause fix for the original "Wes@" canary).
 *   - The loser's email becomes a PersonEmailAlias UNLESS it equals
 *     the survivor's post-normalize canonical email (covered case:
 *     "Wes@" ↔ "wes@"). Skipping the redundant alias avoids a unique
 *     collision with the canonical column.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeEmail } from './email'

/** Reviewer-overridable fields surfaced by the /admin/dedup UI when
 *  survivor and loser both hold non-null-but-different values. The
 *  default merge rule is "survivor wins, fill nulls from loser"; these
 *  let the reviewer flip individual fields without editing the
 *  survivor afterward. Whatever the reviewer picks lands on the
 *  survivor's Person row inside the merge transaction. */
export interface MergeFieldOverrides {
  firstName?: string
  lastName?: string
  phone?: string | null
  mobile?: string | null
  role?:
    | 'UPM' | 'PRODUCER' | 'LINE_PRODUCER' | 'PRODUCTION_COORDINATOR'
    | 'PRODUCTION_SUPERVISOR' | 'TRANSPORTATION_COORDINATOR'
    | 'ART_COORDINATOR' | 'COORDINATOR' | 'OWNER' | 'OTHER'
  tier?: 'VIP' | 'PREFERRED' | 'STANDARD' | 'NEW'
  rawTitle?: string | null
  lastKnownProject?: string | null
  notes?: string | null
}

export interface MergePersonsInput {
  survivorId: string
  loserId: string
  /** User id performing the merge — stamped on PersonMerge.mergedById
   *  for audit. */
  mergedById: string
  /** Reviewer's pick of which email becomes the survivor's canonical
   *  email. Must be either the survivor's or the loser's existing
   *  email (case-insensitive match). The OTHER address always becomes
   *  a PersonEmailAlias so future inbound mail to it still resolves
   *  to the survivor. Default: survivor's current email lowercased
   *  (covers the canary case + every common situation).
   *
   *  Example: survivor has refs but holds "Wes@sirreel.com"; loser
   *  holds the clean "wes@sirreel.com". Reviewer passes
   *  canonicalEmail="wes@sirreel.com" → survivor's email becomes
   *  "wes@sirreel.com", the old "Wes@sirreel.com" becomes the alias
   *  (de-facto a no-op since the case-only diff). For the more useful
   *  Sonia case — survivor email "hello@remafilms.com", loser email
   *  "sonia.sanchez@remafilms.com" — the reviewer can pick the
   *  personal address as canonical even though the generic one had
   *  more refs. */
  canonicalEmail?: string
  /** Per-field overrides surfaced by the /admin/dedup conflict UI.
   *  Optional; omitted fields use the survivor's existing value
   *  (with null-fill from loser still applied via the existing
   *  enrich-not-overwrite rule for null fields). */
  fieldOverrides?: MergeFieldOverrides
}

/** Discrimated structure for one entry in PersonMerge.repointLog.
 *  Reversal reads this back. */
export type RepointEntry =
  | { table: string; op: 'repoint'; column: string; rowIds: string[] }
  | { table: string; op: 'delete'; rowIds: string[]; restoreData: Array<Record<string, unknown>> }
  | { table: string; op: 'sum'; column: string; surviving: string; addedFromLoser: number; field: string }

export interface MergePersonsResult {
  mergeId: string
  survivorId: string
  loserId: string
  aliasInserted: boolean
  repointCounts: Record<string, number>
}

const REPOINT_TABLES = [
  // [model field, FK column, table label in repointLog]
  { model: 'booking' as const, fkField: 'personId' as const, label: 'bookings/personId' },
  { model: 'booking' as const, fkField: 'referredById' as const, label: 'bookings/referredById' },
  { model: 'order' as const, fkField: 'jobContactId' as const, label: 'sr_orders/jobContactId' },
  { model: 'outreachActivity' as const, fkField: 'personId' as const, label: 'sr_outreach_activities/personId' },
  { model: 'activity' as const, fkField: 'personId' as const, label: 'activities_crm/personId' },
  { model: 'emailMessage' as const, fkField: 'personId' as const, label: 'email_messages/personId' },
  { model: 'inquiry' as const, fkField: 'personId' as const, label: 'sr_inquiries/personId' },
  { model: 'inquiryCapture' as const, fkField: 'personId' as const, label: 'sr_inquiry_captures/personId' },
  { model: 'personSession' as const, fkField: 'personId' as const, label: 'person_sessions/personId' },
  { model: 'portalAccess' as const, fkField: 'contactId' as const, label: 'sr_portal_accesses/contactId' },
] as const

export async function mergePersons(input: MergePersonsInput): Promise<MergePersonsResult> {
  const { survivorId, loserId, mergedById, canonicalEmail, fieldOverrides } = input
  if (survivorId === loserId) {
    throw new Error('mergePersons: survivor and loser are the same id')
  }

  // ── Pre-flight reads (outside transaction — pure SELECTs). The
  //    actual mutations happen in the transaction below. We read the
  //    loser snapshot up here so its full shape lands on PersonMerge.
  const [survivor, loser] = await Promise.all([
    prisma.person.findUnique({ where: { id: survivorId } }),
    prisma.person.findUnique({ where: { id: loserId } }),
  ])
  if (!survivor) throw new Error(`mergePersons: survivor ${survivorId} not found`)
  if (!loser) throw new Error(`mergePersons: loser ${loserId} not found`)

  // User collision check — two portal logins for one human means
  // human triage, not silent merge.
  const [survivorUser, loserUser] = await Promise.all([
    prisma.user.findFirst({ where: { personId: survivorId }, select: { id: true } }),
    prisma.user.findFirst({ where: { personId: loserId }, select: { id: true } }),
  ])
  if (survivorUser && loserUser) {
    throw new Error(
      `mergePersons: both ${survivorId} and ${loserId} have User rows (${survivorUser.id}, ${loserUser.id}). ` +
      `Two portal accounts for one human — needs manual decision before merge.`,
    )
  }

  // Snapshot the loser. We capture EVERY field so reversal is a
  // straightforward JSON unpack — no field-by-field guessing.
  const loserSnapshot: Record<string, unknown> = { ...loser }

  // Normalized emails — survivor's current, loser's, and the picked
  // canonical (defaults to survivor's). The reviewer can pick the
  // loser's email as canonical; the email NOT chosen becomes an alias
  // (unless it's a case-only duplicate of the canonical one).
  const survivorEmailLower = normalizeEmail(survivor.email)
  const loserEmailLower = normalizeEmail(loser.email)
  const canonicalLower = canonicalEmail
    ? normalizeEmail(canonicalEmail)
    : survivorEmailLower
  if (canonicalLower !== survivorEmailLower && canonicalLower !== loserEmailLower) {
    throw new Error(
      `mergePersons: canonicalEmail "${canonicalEmail}" must match the survivor's ` +
      `or loser's existing email (case-insensitive)`,
    )
  }
  // Which other email needs to become an alias? The one the reviewer
  // DIDN'T pick. Skipped when both normalize to the same string
  // (canary case).
  const aliasEmail =
    canonicalLower === survivorEmailLower
      ? (loserEmailLower !== canonicalLower ? loserEmailLower : null)
      : (survivorEmailLower !== canonicalLower ? survivorEmailLower : null)
  const aliasNeeded = aliasEmail != null

  const repointLog: RepointEntry[] = []
  const repointCounts: Record<string, number> = {}

  let mergeId = ''
  let aliasInserted = false

  await prisma.$transaction(async (tx) => {
    // ── 1) Simple repoints — every table where the FK column is
    //       single-valued and has no relevant unique constraint.
    for (const { model, fkField, label } of REPOINT_TABLES) {
      // TS can't narrow over the union of model accessors; the cast
      // here is local and safe (we know the model + field shape).
      const repo = (tx as unknown as Record<string, {
        findMany: (args: unknown) => Promise<{ id: string }[]>
        updateMany: (args: unknown) => Promise<{ count: number }>
      }>)[model]
      const before = await repo.findMany({
        where: { [fkField]: loserId },
        select: { id: true },
      })
      const ids = before.map((r) => r.id)
      if (ids.length > 0) {
        await repo.updateMany({
          where: { id: { in: ids } },
          data: { [fkField]: survivorId },
        })
        repointLog.push({ table: label, op: 'repoint', column: fkField, rowIds: ids })
      }
      repointCounts[label] = ids.length
    }

    // ── 2) JobContact — unique on (jobId, personId, role). For each
    //       loser row, check if survivor already owns the same
    //       (jobId, role); if yes, delete the loser row (survivor
    //       covers); else repoint.
    const loserJobContacts = await tx.jobContact.findMany({
      where: { personId: loserId },
    })
    const collisions: { id: string; jobId: string; role: 'PRODUCER' | 'PM' | 'PC' | 'TRANSPO' | 'ACCOUNTING' | 'OTHER'; isPrimary: boolean; createdAt: Date }[] = []
    const survivable: string[] = []
    for (const jc of loserJobContacts) {
      const dupe = await tx.jobContact.findFirst({
        where: { jobId: jc.jobId, personId: survivorId, role: jc.role },
        select: { id: true },
      })
      if (dupe) {
        collisions.push(jc)
      } else {
        survivable.push(jc.id)
      }
    }
    if (survivable.length > 0) {
      await tx.jobContact.updateMany({
        where: { id: { in: survivable } },
        data: { personId: survivorId },
      })
      repointLog.push({ table: 'sr_job_contacts/personId', op: 'repoint', column: 'personId', rowIds: survivable })
    }
    if (collisions.length > 0) {
      await tx.jobContact.deleteMany({ where: { id: { in: collisions.map((c) => c.id) } } })
      repointLog.push({
        table: 'sr_job_contacts/personId',
        op: 'delete',
        rowIds: collisions.map((c) => c.id),
        // restoreData lets reversal recreate the row with original
        // id + every column. JobContact has no FK back to PersonMerge,
        // so this is the only path back.
        restoreData: collisions.map((c) => ({
          id: c.id, jobId: c.jobId, personId: loserId, role: c.role,
          isPrimary: c.isPrimary, createdAt: c.createdAt,
        })),
      })
    }
    repointCounts['sr_job_contacts/personId'] = (survivable.length + collisions.length)

    // ── 3) Affiliation — unique on (personId, companyId, productionName).
    //       Collision: sum totalSpend + totalBookings into survivor row,
    //       then delete loser row. Reversal restores the loser row +
    //       subtracts the summed values from the survivor.
    const loserAffils = await tx.affiliation.findMany({
      where: { personId: loserId },
    })
    const affilCollisions: Array<{
      loserRowId: string
      survivorRowId: string
      addedSpend: number
      addedBookings: number
      restoreData: Record<string, unknown>
    }> = []
    const affilSurvivable: string[] = []
    for (const a of loserAffils) {
      const dupe = await tx.affiliation.findFirst({
        where: { personId: survivorId, companyId: a.companyId, productionName: a.productionName },
        select: { id: true, totalSpend: true, totalBookings: true },
      })
      if (dupe) {
        const addedSpend = Number(a.totalSpend)
        const addedBookings = a.totalBookings
        await tx.affiliation.update({
          where: { id: dupe.id },
          data: {
            totalSpend: { increment: addedSpend },
            totalBookings: { increment: addedBookings },
          },
        })
        affilCollisions.push({
          loserRowId: a.id,
          survivorRowId: dupe.id,
          addedSpend,
          addedBookings,
          restoreData: {
            id: a.id, personId: loserId, companyId: a.companyId,
            productionName: a.productionName, roleOnShow: a.roleOnShow,
            startDate: a.startDate, endDate: a.endDate, isCurrent: a.isCurrent,
            totalSpend: a.totalSpend, totalBookings: a.totalBookings,
            notes: a.notes, createdAt: a.createdAt,
          },
        })
      } else {
        affilSurvivable.push(a.id)
      }
    }
    if (affilSurvivable.length > 0) {
      await tx.affiliation.updateMany({
        where: { id: { in: affilSurvivable } },
        data: { personId: survivorId },
      })
      repointLog.push({ table: 'affiliations/personId', op: 'repoint', column: 'personId', rowIds: affilSurvivable })
    }
    for (const c of affilCollisions) {
      repointLog.push({
        table: 'affiliations/personId',
        op: 'sum',
        column: 'totalSpend',
        surviving: c.survivorRowId,
        addedFromLoser: c.addedSpend,
        field: 'totalSpend',
      })
      repointLog.push({
        table: 'affiliations/personId',
        op: 'sum',
        column: 'totalBookings',
        surviving: c.survivorRowId,
        addedFromLoser: c.addedBookings,
        field: 'totalBookings',
      })
      repointLog.push({
        table: 'affiliations/personId',
        op: 'delete',
        rowIds: [c.loserRowId],
        restoreData: [c.restoreData],
      })
      await tx.affiliation.delete({ where: { id: c.loserRowId } })
    }
    repointCounts['affiliations/personId'] = (affilSurvivable.length + affilCollisions.length)

    // ── 4) User.personId — at most one side has it (we already
    //       aborted on the two-User case above). If loser has one,
    //       repoint.
    if (loserUser && !survivorUser) {
      await tx.user.update({ where: { id: loserUser.id }, data: { personId: survivorId } })
      repointLog.push({
        table: 'users/personId',
        op: 'repoint',
        column: 'personId',
        rowIds: [loserUser.id],
      })
      repointCounts['users/personId'] = 1
    } else {
      repointCounts['users/personId'] = 0
    }

    // ── 5) Person.worksWithId — self-relation. People who "work
    //       with" the loser now work with the survivor.
    const wwBefore = await tx.person.findMany({
      where: { worksWithId: loserId },
      select: { id: true },
    })
    if (wwBefore.length > 0) {
      await tx.person.updateMany({
        where: { worksWithId: loserId },
        data: { worksWithId: survivorId },
      })
      repointLog.push({
        table: 'people/worksWithId',
        op: 'repoint',
        column: 'worksWithId',
        rowIds: wwBefore.map((r) => r.id),
      })
    }
    repointCounts['people/worksWithId'] = wwBefore.length

    // ── 6) Delete the loser row FIRST. This frees up the loser's
    //       email value so step 7 can safely set the survivor's
    //       email to the canonical pick without colliding on
    //       Person.email's @unique (the canary case: survivor "Wes@"
    //       can't become "wes@" while the loser still owns "wes@").
    await tx.person.delete({ where: { id: loserId } })

    // ── 7) Apply reviewer overrides + canonical email + null-fill
    //       from loser. One Person.update writes them all.
    const survivorUpdate: Record<string, unknown> = {}
    if (survivor.email !== canonicalLower) {
      survivorUpdate.email = canonicalLower
    }
    // Reviewer overrides — explicit values from the conflict UI.
    // Null is a valid choice (e.g. "clear the phone"); undefined
    // means "no override, leave the existing column alone".
    if (fieldOverrides) {
      for (const k of [
        'firstName', 'lastName', 'phone', 'mobile',
        'role', 'tier', 'rawTitle', 'lastKnownProject', 'notes',
      ] as const) {
        if (fieldOverrides[k] !== undefined) {
          survivorUpdate[k] = fieldOverrides[k]
        }
      }
    }
    // Null-fill from loser — only for columns the reviewer didn't
    // explicitly override AND where survivor's current value is null.
    // Mirrors the enrich-not-overwrite rule already used by the
    // capture pipeline.
    const nullFillCandidates: Array<keyof typeof loser> = [
      'phone', 'mobile', 'rawTitle', 'lastKnownProject',
      'assignedAgentId', 'planyoUserId', 'lastBookingAt',
      'sourceMessageId', 'source', 'worksWithId',
    ]
    for (const k of nullFillCandidates) {
      if (k in survivorUpdate) continue
      const survivorVal = (survivor as Record<string, unknown>)[k]
      const loserVal = (loser as Record<string, unknown>)[k]
      if ((survivorVal == null || survivorVal === '') && loserVal != null && loserVal !== '') {
        survivorUpdate[k] = loserVal
      }
    }
    // Accumulator sums — historical totalSpend / totalBookings from
    // both rows. (Note: this is the *Person* denorm, separate from
    // Affiliation.totalSpend which is summed by step 3.)
    const survivorSpend = Number(survivor.totalSpend)
    const loserSpend = Number(loser.totalSpend)
    if (loserSpend !== 0) survivorUpdate.totalSpend = survivorSpend + loserSpend
    if (loser.totalBookings !== 0) survivorUpdate.totalBookings = survivor.totalBookings + loser.totalBookings

    if (Object.keys(survivorUpdate).length > 0) {
      await tx.person.update({
        where: { id: survivorId },
        data: survivorUpdate,
      })
    }

    // ── 8) Write the audit row + (conditionally) the alias. Audit
    //       row first so the alias FK is satisfiable.
    const mergeRow = await tx.personMerge.create({
      data: {
        survivorId,
        // Captured pre-normalize so reverse can restore the survivor's
        // original-case email if needed (covers the canary case where
        // loser.email lowercased == survivor.email lowercased).
        survivorEmailBeforeMerge: survivor.email,
        loserSnapshot: loserSnapshot as Prisma.InputJsonValue,
        repointLog: repointLog as unknown as Prisma.InputJsonValue,
        aliasIds: [],
        mergedById,
      },
      select: { id: true },
    })
    mergeId = mergeRow.id

    if (aliasNeeded && aliasEmail) {
      const alias = await tx.personEmailAlias.create({
        data: {
          personId: survivorId,
          email: aliasEmail,
          mergeId,
        },
        select: { id: true },
      })
      await tx.personMerge.update({
        where: { id: mergeId },
        data: { aliasIds: [alias.id] },
      })
      aliasInserted = true
    }
  })

  return {
    mergeId,
    survivorId,
    loserId,
    aliasInserted,
    repointCounts,
  }
}
