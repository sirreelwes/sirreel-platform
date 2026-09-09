/**
 * "The partner told us they have the dates back."
 *
 * WHY THIS IS NOT A COLUMN. The obvious home for this is
 * SubRental.vendorReleaseAckedAt, and that is where it should eventually
 * live. But adding it means a `prisma db push` against the live Neon DB
 * BEFORE the code that selects it can run anywhere — preview deploys hit
 * the same database as production, so a deploy that lands first 500s the
 * vendor page and the job's sub-rentals panel until somebody runs the
 * migration by hand.
 *
 * The acknowledgement is an EVENT, and we already write that event to
 * AuditLog on the way past. So this reads it back from there instead: no
 * schema change, no migration to sequence against a deploy, and no window
 * where the two are out of step. AuditLog is indexed on
 * (entityType, entityId), which is exactly this lookup.
 *
 * The tradeoff, stated plainly: audit rows are history, and treating
 * history as current state is a compromise. It holds here because the
 * fact is a single timestamp that is written once and never edited, and
 * because every reader goes through the two functions below. Promoting it
 * to a real column later is a change to THIS FILE only — the callers ask
 * "when did they acknowledge?" and don't care where the answer is kept.
 */

import { prisma } from '@/lib/prisma'

/** The one action string that means "partner acknowledged the release". */
export const RELEASE_ACK_ACTION = 'sub_rental.vendor_release_acked'

/**
 * Record the acknowledgement. Idempotent: the FIRST one wins, so a
 * partner who taps the button twice (or opens the email on their phone
 * and again on a laptop) does not get a moved timestamp.
 *
 * Returns the effective ack time and whether this call is what created
 * it, so the caller can decide whether to tell HQ.
 */
export async function recordReleaseAck(
  subRentalId: string,
): Promise<{ ackedAt: Date; created: boolean }> {
  const existing = await getReleaseAck(subRentalId)
  if (existing) return { ackedAt: existing, created: false }
  const now = new Date()
  await prisma.auditLog.create({
    data: {
      action: RELEASE_ACK_ACTION,
      entityType: 'SubRental',
      entityId: subRentalId,
      newValues: { via: 'vendor-page' },
    },
  })
  return { ackedAt: now, created: true }
}

/** When this partner acknowledged the release, or null. */
export async function getReleaseAck(subRentalId: string): Promise<Date | null> {
  const row = await prisma.auditLog.findFirst({
    where: { entityType: 'SubRental', entityId: subRentalId, action: RELEASE_ACK_ACTION },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  })
  return row?.createdAt ?? null
}

/**
 * The same answer for a list, in ONE query — the job's sub-rentals panel
 * renders every partner unit on the job and must not fan out into a
 * lookup per row.
 */
export async function getReleaseAcks(subRentalIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>()
  if (subRentalIds.length === 0) return out
  const rows = await prisma.auditLog.findMany({
    where: {
      entityType: 'SubRental',
      entityId: { in: subRentalIds },
      action: RELEASE_ACK_ACTION,
    },
    orderBy: { createdAt: 'asc' },
    select: { entityId: true, createdAt: true },
  })
  // Ascending, first write wins — matches recordReleaseAck's own rule.
  for (const r of rows) if (!out.has(r.entityId)) out.set(r.entityId, r.createdAt)
  return out
}
