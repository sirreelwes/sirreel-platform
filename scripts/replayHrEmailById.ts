/**
 * Replay a hr@-addressed message into the HR pipeline by gmailMessageId.
 *
 * Use case: a message that was forwarded by the hr@ alias into dani@
 * (or another watched inbox) BEFORE the path-B routing-header branch
 * shipped — it sits in EmailMessage today but never reached HrEmail.
 * This script reads the routing headers off that EmailMessage row,
 * calls ingestHrEmail with the original inbox and headers, and
 * verifies an HrEmail / HrMail row is now present.
 *
 * The EmailMessage row is LEFT IN PLACE. Deleting it would risk
 * cascading into ClaimMail and other downstream consumers; for the
 * straggler messages from before path B shipped, dual-residency is
 * an acceptable transition state. Going forward, the pubsub branch
 * skips the EmailMessage write entirely so no new dual rows are
 * created.
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/replayHrEmailById.ts <gmailMessageId>
 *
 * Or omit the id and the script finds + replays every untouched
 * straggler in the last 30 days.
 */

import './_loadProdEnv'
import { PrismaClient } from '@prisma/client'
import { ingestHrEmail } from '../src/lib/hr/ingestHrEmail'
import type { RoutingHeaders } from '../src/lib/email/routingHeaders'

const p = new PrismaClient()

interface Candidate {
  id: string
  gmailMessageId: string
  inbox: string
  fromAddress: string
  subject: string
  routingHeaders: RoutingHeaders | null
}

async function findCandidates(specificGmailId: string | null): Promise<Candidate[]> {
  const where: Record<string, unknown> = {}
  if (specificGmailId) {
    where.gmailMessageId = specificGmailId
  } else {
    where.sentAt = { gte: new Date(Date.now() - 30 * 86400_000) }
  }
  const rows = await p.emailMessage.findMany({
    where,
    select: {
      id: true,
      gmailMessageId: true,
      fromAddress: true,
      subject: true,
      routingHeaders: true,
      emailAccount: { select: { emailAddress: true } },
    },
  })
  const out: Candidate[] = []
  for (const r of rows) {
    const rh = r.routingHeaders as RoutingHeaders | null
    if (!rh) continue
    const fields = [rh.to, rh.cc, rh.deliveredTo, rh.xOriginalTo, rh.xForwardedFor, rh.xForwardedTo]
    const matches = fields.some((v) => v && v.toLowerCase().includes('hr@sirreel.com'))
    if (!matches) continue
    // Skip if HrEmail already exists for this gmail message id.
    const existing = await p.hrEmail.findUnique({
      where: { gmailMessageId: r.gmailMessageId },
      select: { id: true },
    })
    if (existing) continue
    out.push({
      id: r.id,
      gmailMessageId: r.gmailMessageId,
      inbox: r.emailAccount.emailAddress,
      fromAddress: r.fromAddress,
      subject: r.subject ?? '(no subject)',
      routingHeaders: rh,
    })
  }
  return out
}

async function main() {
  const arg = process.argv[2] ?? null
  const candidates = await findCandidates(arg)
  if (candidates.length === 0) {
    console.log(arg ? `No untouched candidate for ${arg}` : 'No untouched hr-addressed stragglers in the last 30 days')
    return
  }
  console.log(`Replaying ${candidates.length} message(s) into HR pipeline…\n`)
  for (const c of candidates) {
    console.log(`  ${c.gmailMessageId}  inbox=${c.inbox}  subject="${c.subject.slice(0, 50)}"`)
    const result = await ingestHrEmail({
      inbox: c.inbox,
      gmailMessageId: c.gmailMessageId,
      fromAddress: c.fromAddress,
      routingHeaders: c.routingHeaders,
    })
    console.log(`    → status=${result.status} reason=${result.reason ?? '-'} hrMailId=${result.hrMailId ?? '-'} attachments=${result.attachmentsAttached ?? 0}`)
  }
}

main()
  .catch((err) => { console.error('Replay failed:', err); process.exit(1) })
  .finally(() => p.$disconnect())
