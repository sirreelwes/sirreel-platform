import { prisma } from '../src/lib/prisma'
import { resolveJob } from '../src/lib/jobs/resolveJob'
import { attachInquiryThreadToJob, fileThreadInJobIfUnfiled } from '../src/lib/jobs/attachThreadToJob'

const ACCOUNT_ID = '0c4b72f0-21f4-40e9-8a7e-98dfe5b2552c'

async function main() {
  const job = await prisma.job.findFirst({ where: { jobCode: 'SR-JOB-0001' }, select: { id: true, jobCode: true } })
  const otherJob = await prisma.job.findFirst({ where: { jobCode: 'SR-JOB-0010' }, select: { id: true } })
  if (!job || !otherJob) throw new Error('expected jobs missing')

  // Throwaway thread + inbound message
  const thread = await prisma.emailThread.create({
    data: { gmailThreadId: 'zztest-step6-thread', subject: 'ZZTEST step6', lastMessageAt: new Date(), messageCount: 1, lastDirection: 'INBOUND' },
    select: { id: true },
  })
  const msg = await prisma.emailMessage.create({
    data: {
      emailAccountId: ACCOUNT_ID, gmailMessageId: 'zztest-step6-msg', threadId: thread.id,
      fromAddress: 'wes@sirreel.com', toAddresses: ['info@sirreel.com'], subject: 'ZZTEST step6',
      direction: 'inbound', sentAt: new Date(),
    },
    select: { id: true },
  })

  // 1) unfiled thread → rung ① silent → NO_MATCH
  const r1 = await resolveJob({ threadId: thread.id, sourceRef: 'zztest' })
  console.log('unfiled:', r1.bucket, '(expect NO_MATCH)')

  // 2) file (fill-only helper) → then rung ① fires
  const filed = await fileThreadInJobIfUnfiled(thread.id, job.id)
  const r2 = await resolveJob({ threadId: thread.id, sourceRef: 'zztest' })
  const top = r2.candidates[0]
  console.log('filed:', filed, '→', r2.bucket, top ? `[${top.jobCode}] score=${top.score} :: ${top.reasons.join(' | ')}` : 'NONE', '(expect CLEAN_MATCH 100 on SR-JOB-0001)')

  // 3) fill-only holds: second file to a DIFFERENT job must be a no-op
  const refiled = await fileThreadInJobIfUnfiled(thread.id, otherJob.id)
  const after = await prisma.emailThread.findUnique({ where: { id: thread.id }, select: { jobId: true } })
  console.log('fill-only holds:', refiled === false && after?.jobId === job.id ? '✓ not re-pointed' : '✗ RE-POINTED')

  // 4) gmailThreadId key also resolves (attach route + rung accept either)
  const r3 = await resolveJob({ threadId: 'zztest-step6-thread', sourceRef: 'zztest' })
  console.log('gmail-key lookup:', r3.bucket, '(expect CLEAN_MATCH)')

  // 5) inquiry-conversion attach: unfile, then attach via inquiry metadata
  await prisma.emailThread.update({ where: { id: thread.id }, data: { jobId: null } })
  const inq = await prisma.inquiry.create({
    data: { source: 'GMAIL', status: 'NEW', title: 'ZZTEST step6 inquiry', description: 'zztest', sourceMetadata: { emailMessageId: msg.id } },
    select: { id: true },
  })
  const attached = await attachInquiryThreadToJob(inq.id, job.id)
  const check = await prisma.emailThread.findUnique({ where: { id: thread.id }, select: { jobId: true } })
  console.log('inquiry-conversion attach:', attached && check?.jobId === job.id ? '✓ filed via sourceMetadata.emailMessageId' : '✗ FAILED')

  // cleanup by captured ids
  await prisma.inquiry.delete({ where: { id: inq.id } })
  await prisma.emailMessage.delete({ where: { id: msg.id } })
  await prisma.emailThread.delete({ where: { id: thread.id } })
  console.log('cleanup done (inquiry/message/thread by captured id)')
}
main().finally(() => prisma.$disconnect())
