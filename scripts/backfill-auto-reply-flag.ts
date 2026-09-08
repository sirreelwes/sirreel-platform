/**
 * Flag historical out-of-office messages, and un-stamp the threads they
 * falsely marked as answered.
 *
 * Origin — 2026-09-08: a new-account request from Juan Gonzalez reached
 * oliver@ at 02:20 UTC. Oliver's vacation responder answered at 02:20,
 * stamping EmailThread.lastOutboundAt; the client's real reply landed at
 * 02:21. New inbound treats any outbound on the thread as "we responded",
 * so the lead was muted. Oliver: "did not see this inquiry on my HQ
 * dashboard."
 *
 * The ingest now detects auto-replies from their headers and refuses to
 * let them stamp thread state (src/lib/email/autoReply.ts). This script
 * repairs what was written before that:
 *
 *   1. EmailMessage.autoReply = true on historical responders. Their
 *      headers were never captured, so detection falls back to the
 *      subject banner — which is why the banner test looks at the text
 *      BEFORE the "Re:" (a responder prepends its banner; a human writes
 *      "Re: out of office coverage"). Scoped to OUTBOUND messages: this
 *      is the "did WE respond" signal, and an inbound client responder
 *      never stamps anything.
 *
 *   2. EmailThread direction state recomputed from the surviving human
 *      messages on each affected thread — lastOutboundAt/lastInboundAt/
 *      lastDirection derived, never guessed.
 *
 * What it deliberately does NOT do: clear Inquiry.respondedAt on the
 * inquiries an auto-reply falsely marked as answered. It REPORTS them.
 * Un-stamping changes what the team is chased about, so it is Wes's
 * call, not a side effect of a backfill.
 *
 * Every write is by captured id and journalled to journals/.
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/backfill-auto-reply-flag.ts           # dry run
 *   npx tsx scripts/backfill-auto-reply-flag.ts --apply
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'fs'
import { autoReplySubjectMarker } from '../src/lib/email/autoReply'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

async function main() {
  // Candidate pool: every outbound message not already flagged. Filtering
  // in JS keeps the banner rule in ONE place (the lib the ingest uses).
  const outbound = await prisma.emailMessage.findMany({
    where: { direction: 'outbound', autoReply: false },
    select: { id: true, subject: true, fromAddress: true, toAddresses: true, sentAt: true, threadId: true },
    orderBy: { sentAt: 'asc' },
  })
  const autos = outbound.filter((m) => autoReplySubjectMarker(m.subject))

  console.log(`outbound scanned: ${outbound.length}`)
  console.log(`auto-replies found: ${autos.length}`)
  for (const m of autos.slice(-15)) {
    console.log(`  ${m.sentAt.toISOString()}  ${m.fromAddress} → ${m.toAddresses[0]}  ${m.subject.slice(0, 80)}`)
  }
  if (autos.length > 15) console.log(`  … ${autos.length - 15} earlier`)

  const autoIds = autos.map((m) => m.id)
  const threadIds = [...new Set(autos.map((m) => m.threadId).filter((v): v is string => !!v))]

  // Which of those threads are actually mis-stamped? A thread whose
  // lastOutboundAt equals a human send is already correct.
  const affected: {
    threadId: string
    before: { lastInboundAt: Date | null; lastOutboundAt: Date | null; lastDirection: string | null }
    after: { lastInboundAt: Date | null; lastOutboundAt: Date | null; lastDirection: string | null }
  }[] = []

  for (const tid of threadIds) {
    const thread = await prisma.emailThread.findUnique({
      where: { id: tid },
      select: { id: true, lastInboundAt: true, lastOutboundAt: true, lastDirection: true },
    })
    if (!thread || !thread.lastOutboundAt) continue

    const msgs = await prisma.emailMessage.findMany({
      where: { threadId: tid },
      select: { id: true, direction: true, sentAt: true, subject: true },
    })
    const isAuto = (m: { direction: string; subject: string }) =>
      m.direction === 'outbound' && autoReplySubjectMarker(m.subject)

    // Only repair a thread we can PROVE was stamped by a responder: its
    // lastOutboundAt is an auto-reply's send time. Anything else is left
    // exactly as it is — a thread may carry a real reply this database
    // never stored (a send from an unwatched inbox), and clearing that
    // would push an answered lead back into the queue.
    const stampedByAuto = msgs.some(
      (m) => isAuto(m) && Math.abs(m.sentAt.getTime() - thread.lastOutboundAt!.getTime()) < 1000,
    )
    if (!stampedByAuto) continue

    // Recompute the OUTBOUND side only, from the human sends that remain.
    // The inbound side was never touched by an outbound responder.
    const lastOutboundAt = msgs
      .filter((m) => m.direction === 'outbound' && !isAuto(m))
      .reduce<Date | null>((a, m) => (!a || m.sentAt > a ? m.sentAt : a), null)
    const lastInboundAt = thread.lastInboundAt
    const lastDirection =
      lastOutboundAt && lastInboundAt
        ? lastOutboundAt >= lastInboundAt
          ? 'OUTBOUND'
          : 'INBOUND'
        : lastOutboundAt
          ? 'OUTBOUND'
          : lastInboundAt
            ? 'INBOUND'
            : null

    affected.push({
      threadId: tid,
      before: { lastInboundAt: thread.lastInboundAt, lastOutboundAt: thread.lastOutboundAt, lastDirection: thread.lastDirection },
      after: { lastInboundAt, lastOutboundAt, lastDirection },
    })
  }

  console.log(`\nthreads whose direction state was set by an auto-reply: ${affected.length}`)

  // Inquiries whose respondedAt was stamped by one of these — reported,
  // never cleared. See the header note.
  const autoSet = new Set(autoIds)
  const stampedInquiries: { id: string; title: string; respondedAt: Date | null; respondedBy: string | null }[] = []
  const openInquiries = await prisma.inquiry.findMany({
    where: { respondedAt: { not: null } },
    select: { id: true, title: true, respondedAt: true, respondedBy: true, status: true, rfc822MessageId: true, sourceMetadata: true },
  })
  for (const inq of openInquiries) {
    if (!inq.respondedAt) continue
    // An auto-reply from the recorded responder, at the recorded second.
    const match = autos.find(
      (m) =>
        Math.abs(m.sentAt.getTime() - inq.respondedAt!.getTime()) < 1000 &&
        (!inq.respondedBy || m.fromAddress.toLowerCase().includes(inq.respondedBy.toLowerCase())),
    )
    if (match && autoSet.has(match.id)) {
      stampedInquiries.push({ id: inq.id, title: inq.title, respondedAt: inq.respondedAt, respondedBy: inq.respondedBy })
    }
  }
  console.log(`inquiries whose respondedAt came from an auto-reply: ${stampedInquiries.length}`)
  for (const i of stampedInquiries) console.log(`  ${i.id}  ${i.respondedBy}  ${i.title.slice(0, 70)}`)

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to write.')
    return
  }

  mkdirSync('journals', { recursive: true })
  const path = `journals/backfill-auto-reply-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(
    path,
    JSON.stringify({ flaggedMessageIds: autoIds, messages: autos, threads: affected, inquiriesReportedNotCleared: stampedInquiries }, null, 2),
  )
  console.log(`\njournal: ${path}`)

  // Writes are by captured id only.
  if (autoIds.length) {
    const r = await prisma.emailMessage.updateMany({ where: { id: { in: autoIds } }, data: { autoReply: true } })
    console.log(`flagged ${r.count} messages`)
  }
  for (const a of affected) {
    await prisma.emailThread.update({
      where: { id: a.threadId },
      // Outbound side only — see the recompute above.
      data: { lastOutboundAt: a.after.lastOutboundAt, lastDirection: a.after.lastDirection },
    })
  }
  console.log(`repaired ${affected.length} threads`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
