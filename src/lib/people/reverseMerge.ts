/**
 * reverseMerge — walks PersonMerge.repointLog backward and restores
 * the loser Person + every FK row that moved.
 *
 * Reversal is only as trustworthy as the audit log. The merge primitive
 * (mergePersons.ts) commits the log INSIDE the same transaction as the
 * mutations, so a successful merge always has a complete log. This
 * function trusts that contract.
 *
 * Reversal contract:
 *   - Runs inside a single `prisma.$transaction`. If any step throws
 *     (e.g. survivor's email was edited downstream and the loser's old
 *     email is no longer available), the transaction rolls back, the
 *     PersonMerge row gains `reversalErrors`, and a human is paged.
 *   - The loser row is re-created with the SAME id (preserved from
 *     snapshot) so any external system that cached the id keeps
 *     working.
 *   - PersonMerge.reversedAt / reversedById are stamped. The row stays
 *     in place forever — never deleted. A future re-merge mints a
 *     fresh PersonMerge with a fresh snapshot/log; the reversed-and-
 *     re-merged loop is fully auditable.
 *
 * A row whose `reversedAt` is already set cannot be reversed again
 * (idempotency).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { RepointEntry } from './mergePersons'

export interface ReverseMergeInput {
  mergeId: string
  reversedById: string
}

export interface ReverseMergeResult {
  mergeId: string
  restoredLoserId: string
  repointCounts: Record<string, number>
}

export async function reverseMerge(input: ReverseMergeInput): Promise<ReverseMergeResult> {
  const { mergeId, reversedById } = input

  const merge = await prisma.personMerge.findUnique({ where: { id: mergeId } })
  if (!merge) throw new Error(`reverseMerge: PersonMerge ${mergeId} not found`)
  if (merge.reversedAt) {
    throw new Error(`reverseMerge: PersonMerge ${mergeId} already reversed at ${merge.reversedAt.toISOString()}`)
  }

  const snapshot = merge.loserSnapshot as Record<string, unknown>
  const log = merge.repointLog as unknown as RepointEntry[]
  const loserId = snapshot.id as string
  if (!loserId) {
    throw new Error(`reverseMerge: PersonMerge ${mergeId}.loserSnapshot has no id`)
  }

  const repointCounts: Record<string, number> = {}

  try {
    await prisma.$transaction(async (tx) => {
      // ── 0) If the merge primitive normalized the survivor's email
      //       to lowercase and the captured pre-merge value differs
      //       from the current value, restore the survivor's email
      //       FIRST. This frees the lowercased string for the loser
      //       restoration in step 1 (the canary case: survivor was
      //       "Wes@" before merge, became "wes@" after; loser was
      //       "wes@" — without restoring survivor's case we can't
      //       recreate the loser row).
      if (merge.survivorEmailBeforeMerge) {
        const currentSurvivor = await tx.person.findUnique({
          where: { id: merge.survivorId },
          select: { email: true },
        })
        if (currentSurvivor && currentSurvivor.email !== merge.survivorEmailBeforeMerge) {
          await tx.person.update({
            where: { id: merge.survivorId },
            data: { email: merge.survivorEmailBeforeMerge },
          })
        }
      }

      // ── 1) Restore the loser Person row from snapshot. Same id so
      //       external caches keep working. Date fields come back as
      //       ISO strings via JSON; coerce.
      const restoreData: Prisma.PersonUncheckedCreateInput = {
        id: snapshot.id as string,
        firstName: snapshot.firstName as string,
        lastName: snapshot.lastName as string,
        email: snapshot.email as string,
        phone: (snapshot.phone as string | null) ?? null,
        mobile: (snapshot.mobile as string | null) ?? null,
        role: snapshot.role as Prisma.PersonUncheckedCreateInput['role'],
        tier: snapshot.tier as Prisma.PersonUncheckedCreateInput['tier'],
        assignedAgentId: (snapshot.assignedAgentId as string | null) ?? null,
        totalSpend: (snapshot.totalSpend as string | number | null) ?? 0,
        totalBookings: (snapshot.totalBookings as number | null) ?? 0,
        lastBookingAt: snapshot.lastBookingAt ? new Date(snapshot.lastBookingAt as string) : null,
        worksWithId: (snapshot.worksWithId as string | null) ?? null,
        planyoUserId: (snapshot.planyoUserId as number | null) ?? null,
        notes: (snapshot.notes as string | null) ?? null,
        isActive: (snapshot.isActive as boolean | undefined) ?? true,
        source: (snapshot.source as string | null) ?? null,
        sourceMessageId: (snapshot.sourceMessageId as string | null) ?? null,
        rawTitle: (snapshot.rawTitle as string | null) ?? null,
        lastKnownProject: (snapshot.lastKnownProject as string | null) ?? null,
        createdAt: snapshot.createdAt ? new Date(snapshot.createdAt as string) : undefined,
        updatedAt: snapshot.updatedAt ? new Date(snapshot.updatedAt as string) : undefined,
      }
      await tx.person.create({ data: restoreData })

      // ── 2) Drop the aliases minted by this merge. PersonEmailAlias
      //       has onDelete: SetNull on the merge FK; we want hard
      //       delete so the loser's email is no longer routed to
      //       the survivor.
      if (merge.aliasIds.length > 0) {
        await tx.personEmailAlias.deleteMany({
          where: { id: { in: merge.aliasIds } },
        })
      }

      // ── 3) Walk repointLog in REVERSE order. Each entry inverts:
      //       - repoint: move rows back from survivor → loser
      //       - delete: re-create the rows with the captured snapshot
      //       - sum: subtract the added amount from the survivor's row
      for (let i = log.length - 1; i >= 0; i--) {
        const entry = log[i]
        repointCounts[entry.table] = (repointCounts[entry.table] ?? 0) + ('rowIds' in entry ? entry.rowIds.length : 1)

        if (entry.op === 'repoint') {
          // Map table label back to the model name. The label format
          // is "tablename/fkfield" — we use the field name on the model
          // directly via the same map the merge primitive used.
          await applyRepoint(tx, entry.table, entry.column, entry.rowIds, loserId)
        } else if (entry.op === 'delete') {
          await applyDeleteReversal(tx, entry.table, entry.restoreData)
        } else if (entry.op === 'sum') {
          await applySumReversal(tx, entry.table, entry.surviving, entry.field, entry.addedFromLoser)
        }
      }

      // ── 4) Survivor's email — we lowercased it during merge. We do
      //       NOT undo that. Reversal restores the loser, but the
      //       survivor's email STAYS lowercased — the root-cause fix
      //       is independent of the merge decision. (A reviewer who
      //       wants the case back is welcome to edit it.)

      // ── 5) Stamp PersonMerge.reversedAt + reversedById. We deliberately
      //       leave the snapshot + log in place — the row is the audit
      //       trail of both the merge AND its reversal.
      await tx.personMerge.update({
        where: { id: mergeId },
        data: {
          reversedAt: new Date(),
          reversedById,
          reversalErrors: Prisma.JsonNull,
        },
      })
    })
  } catch (err) {
    // The transaction already rolled back. Record the error on the
    // PersonMerge row so the human triaging knows what to look at;
    // the row stays unreversed.
    await prisma.personMerge.update({
      where: { id: mergeId },
      data: {
        reversalErrors: {
          attemptedAt: new Date().toISOString(),
          attemptedById: reversedById,
          message: err instanceof Error ? err.message : String(err),
        } as Prisma.InputJsonValue,
      },
    })
    throw err
  }

  return { mergeId, restoredLoserId: loserId, repointCounts }
}

// ─────────────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/** Repoint reversal: move rows back from survivor → loser. */
async function applyRepoint(
  tx: Tx, label: string, column: string, rowIds: string[], loserId: string,
): Promise<void> {
  if (rowIds.length === 0) return
  const model = modelForLabel(label)
  const repo = (tx as unknown as Record<string, {
    updateMany: (args: unknown) => Promise<unknown>
  }>)[model]
  await repo.updateMany({
    where: { id: { in: rowIds } },
    data: { [column]: loserId },
  })
}

/** Delete reversal: recreate each deleted row from its snapshot. */
async function applyDeleteReversal(
  tx: Tx, label: string, restoreData: Array<Record<string, unknown>>,
): Promise<void> {
  if (restoreData.length === 0) return
  const model = modelForLabel(label)
  const repo = (tx as unknown as Record<string, {
    create: (args: unknown) => Promise<unknown>
  }>)[model]
  for (const row of restoreData) {
    // Date columns came through JSON as ISO strings; the merge
    // primitive only ever stamps dates that are already Date objects,
    // but JSON round-trip turns them into strings. Coerce on the way
    // back.
    const coerced: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
        coerced[k] = new Date(v)
      } else {
        coerced[k] = v
      }
    }
    await repo.create({ data: coerced })
  }
}

/** Sum reversal: decrement the survivor's column by the loser's
 *  contribution captured at merge time. */
async function applySumReversal(
  tx: Tx, label: string, survivingRowId: string, field: string, addedFromLoser: number,
): Promise<void> {
  const model = modelForLabel(label)
  const repo = (tx as unknown as Record<string, {
    update: (args: unknown) => Promise<unknown>
  }>)[model]
  await repo.update({
    where: { id: survivingRowId },
    data: { [field]: { decrement: addedFromLoser } },
  })
}

/** Map the table-label string used in repointLog back to the Prisma
 *  model accessor. Keep this map in sync with REPOINT_TABLES in
 *  mergePersons.ts plus the JobContact/Affiliation/User/worksWithId
 *  branches. */
function modelForLabel(label: string): string {
  const [tbl] = label.split('/')
  switch (tbl) {
    case 'bookings': return 'booking'
    case 'sr_orders': return 'order'
    case 'sr_outreach_activities': return 'outreachActivity'
    case 'activities_crm': return 'activity'
    case 'email_messages': return 'emailMessage'
    case 'sr_inquiries': return 'inquiry'
    case 'sr_inquiry_captures': return 'inquiryCapture'
    case 'person_sessions': return 'personSession'
    case 'sr_portal_accesses': return 'portalAccess'
    case 'sr_job_contacts': return 'jobContact'
    case 'affiliations': return 'affiliation'
    case 'users': return 'user'
    case 'people': return 'person'
    default:
      throw new Error(`modelForLabel: unknown table label "${label}"`)
  }
}

