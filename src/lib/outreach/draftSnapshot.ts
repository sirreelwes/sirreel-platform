/**
 * Write a draft's recipient rows — one per resolved person, SKIPPED with a
 * reason where the copy cannot be personalised.
 *
 * Shared by draft create (POST /api/outreach/campaigns) and draft edit
 * (PATCH /api/outreach/campaigns/[id]). An edit re-snapshots rather than
 * patching rows in place: the audience a rep sees after re-saving must be
 * the audience the copy was rendered for, not a mix of old and new.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import type { ResolvedRecipient } from '@/lib/outreach/campaign'
import { renderForRecipient } from '@/lib/outreach/mergeFields'

type Db = PrismaClient | Prisma.TransactionClient

export async function writeRecipientSnapshot(
  db: Db,
  campaignId: string,
  subject: string,
  template: string,
  recipients: ResolvedRecipient[],
): Promise<Record<string, number>> {
  await db.outreachCampaignRecipient.createMany({
    data: recipients.map((r) => {
      const rendered = renderForRecipient(subject, template, r.ctx)
      return {
        campaignId,
        personId: r.personId,
        email: r.email,
        status: rendered.ok ? ('PENDING' as const) : ('SKIPPED' as const),
        reason: rendered.ok ? null : `No value for ${rendered.missing.join(', ')} on this contact`,
        renderedSubject: rendered.ok ? rendered.subject : null,
        renderedBody: rendered.ok ? rendered.body : null,
      }
    }),
    skipDuplicates: true,
  })

  const statusCounts = await db.outreachCampaignRecipient.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  })
  return Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all]))
}
