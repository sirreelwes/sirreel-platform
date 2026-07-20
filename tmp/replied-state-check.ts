import { prisma } from '../src/lib/prisma'
import { recordQuickReplyOnThread } from '../src/lib/sales/markInquiryResponded'

const ACCOUNT_ID = '0c4b72f0-21f4-40e9-8a7e-98dfe5b2552c'

async function main() {
  // Throwaway inbound with NO thread — the exact path that used to record nothing.
  const inbound = await prisma.emailMessage.create({
    data: {
      emailAccountId: ACCOUNT_ID,
      gmailMessageId: 'zztest-replied-state-check',
      fromAddress: 'wes@sirreel.com',
      toAddresses: ['info@sirreel.com'],
      subject: 'ZZTEST replied-state check',
      snippet: 'throwaway',
      bodyText: 'throwaway verification fixture',
      direction: 'inbound',
      sentAt: new Date(),
      extractedData: { messageNature: 'inquiry', summary: 'zztest' },
      extractionConfidence: 0.9,
    },
    select: { id: true, threadId: true },
  })
  console.log('inbound seeded, threadId:', inbound.threadId)

  const rec = await recordQuickReplyOnThread({
    inboundEmailMessageId: inbound.id,
    staffEmail: 'wes@sirreel.com',
    recipientEmail: 'wes@sirreel.com',
    subject: 'Re: ZZTEST replied-state check',
    bodyText: 'reply body', bodyHtml: null,
  })
  console.log('recordQuickReplyOnThread returned:', rec ? 'RECORDED ✓' : 'null ✗')

  const after = await prisma.emailMessage.findUnique({ where: { id: inbound.id }, select: { threadId: true } })
  const thread = after?.threadId
    ? await prisma.emailThread.findUnique({ where: { id: after.threadId }, select: { id: true, gmailThreadId: true, lastDirection: true, lastOutboundAt: true, messageCount: true } })
    : null
  console.log('thread minted:', thread ? `✓ gmailThreadId=${thread.gmailThreadId} lastDirection=${thread.lastDirection} msgs=${thread.messageCount}` : '✗ MISSING')

  // Would the responded stream pick it up? (same predicates as the route)
  const latestOut = thread
    ? await prisma.emailMessage.findFirst({ where: { threadId: thread.id, direction: 'outbound' }, orderBy: { sentAt: 'desc' }, select: { id: true, fromAddress: true, sentAt: true } })
    : null
  const qualifies = thread?.lastDirection === 'OUTBOUND' && !!latestOut
  console.log(qualifies ? `responded-stream: ✓ "Replied by ${latestOut!.fromAddress}" at ${latestOut!.sentAt.toISOString()}` : 'responded-stream: ✗')

  // Cleanup by captured ids
  if (latestOut) await prisma.emailMessage.delete({ where: { id: latestOut.id } })
  await prisma.emailMessage.delete({ where: { id: inbound.id } })
  if (thread) await prisma.emailThread.delete({ where: { id: thread.id } })
  console.log('cleanup: outbound/inbound/thread deleted by captured id')
}
main().finally(() => prisma.$disconnect())
