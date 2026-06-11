/**
 * One-shot backfill: enforce "one Gmail thread = one Incident" across
 * existing ClaimMail rows. Idempotent + re-runnable.
 *
 * Action per multi-row thread:
 *   - If ≥1 row already has an incidentId → propagate that link to
 *     every other row on the same thread that doesn't.
 *   - If NO row has an incidentId → mint a fresh Incident from the
 *     oldest row (via openIncidentFromClaimMail, which propagates to
 *     siblings automatically post-commit).
 *   - Threads where rows point at DIFFERENT incidents are not merged
 *     — that's pre-existing data and we don't collapse it without
 *     human review.
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/backfillThreadIncidents.ts
 */

import './_loadProdEnv'
import { PrismaClient } from '@prisma/client'
import { openIncidentFromClaimMail } from '../src/lib/incidents/openIncidentFromClaimMail'

const p = new PrismaClient()

async function main() {
  const rows = await p.claimMail.findMany({
    where: { emailMessage: { threadId: { not: null } } },
    select: {
      id: true,
      incidentId: true,
      createdAt: true,
      emailMessage: {
        select: { threadId: true, subject: true, sentAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  const byThread = new Map<string, typeof rows>()
  for (const r of rows) {
    const t = r.emailMessage.threadId!
    const list = byThread.get(t) ?? []
    list.push(r)
    byThread.set(t, list)
  }

  let minted = 0
  let propagated = 0
  let skipped = 0

  for (const [threadId, list] of byThread) {
    if (list.length < 2) continue
    const withInc = list.filter((r) => r.incidentId)
    const withoutInc = list.filter((r) => !r.incidentId)
    const distinctIncidents = new Set(withInc.map((r) => r.incidentId))

    if (distinctIncidents.size > 1) {
      console.warn(
        `Thread ${threadId.slice(0, 8)}: ${distinctIncidents.size} distinct incidents linked across ${list.length} rows. Skipping — review manually.`,
      )
      skipped += 1
      continue
    }

    if (withInc.length === 0) {
      // No incident at all — mint from the oldest row. The helper's
      // post-commit propagation step extends the link to siblings.
      const oldest = list[0]
      const result = await openIncidentFromClaimMail({
        claimMailId: oldest.id,
        createdById: null,
      })
      console.log(
        `Minted ${result.incidentNumber} for thread ${threadId.slice(0, 8)} "${oldest.emailMessage.subject?.slice(0, 60)}" — covers ${list.length} rows`,
      )
      minted += 1
      continue
    }

    if (withoutInc.length === 0) continue // all linked already

    // Some rows linked, some not — propagate from the existing link.
    const target = withInc[0].incidentId!
    const updateRes = await p.claimMail.updateMany({
      where: {
        id: { in: withoutInc.map((r) => r.id) },
      },
      data: { incidentId: target },
    })
    const inc = await p.incident.findUnique({
      where: { id: target },
      select: { incidentNumber: true },
    })
    console.log(
      `Propagated ${inc?.incidentNumber} to ${updateRes.count} sibling rows on thread ${threadId.slice(0, 8)} "${list[0].emailMessage.subject?.slice(0, 60)}"`,
    )
    propagated += 1
  }

  console.log(`\nDone. Minted: ${minted}. Propagated: ${propagated}. Skipped (conflict): ${skipped}.`)
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err)
    process.exit(1)
  })
  .finally(() => p.$disconnect())
