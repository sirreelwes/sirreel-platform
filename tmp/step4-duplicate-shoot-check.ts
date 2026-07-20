import { prisma } from '../src/lib/prisma'
import { resolveJob, createJobFromDraft } from '../src/lib/jobs/resolveJob'
import { resolveCompanyByNameKey } from '../src/lib/companies/resolveCompanyByName'

async function main() {
  const agent = await prisma.user.findFirst({ where: { email: 'wes@sirreel.com' }, select: { id: true } })
  if (!agent) throw new Error('no agent')

  // ── EMAIL #1: "ZZTEST Nightfall" from ZZTEST Moonlight Pictures ──
  // The agent chose "Create new" in the resolver → createJobFromDraft.
  const created = await createJobFromDraft(
    {
      name: 'ZZTEST_Nightfall Shoot',
      companyName: 'ZZTEST Moonlight Pictures LLC',
      contactName: 'Zed Tester',
      contactEmail: 'zztest.nightfall@example.test',
      startDate: '2026-08-10',
      endDate: '2026-08-14',
      status: 'NEW',
    },
    agent.id,
  )
  const jobId = created.job.id
  const companyId = created.job.companyId
  console.log('email #1 → created', created.job.jobCode, created.job.name, 'status', created.job.status, '| company:', created.companyResolution)

  // ── EMAIL #2: same shoot, days later — different phrasing ──
  // Quick Reply / wizard seeds the resolver with the parsed context.
  const r2 = await resolveJob({
    companyName: 'ZZTEST Moonlight Pictures',          // suffix differs
    contactEmail: 'zztest.nightfall@example.test',
    jobNameHint: 'Nightfall',                          // partial name
    dates: { start: '2026-08-11', end: '2026-08-13' }, // overlapping window
    sourceRef: 'sales:quick-reply',
  })
  const top = r2.candidates[0]
  console.log('email #2 → bucket', r2.bucket, '| top candidate:', top ? `${top.jobCode} "${top.name}" score=${top.score} reasons=[${top.reasons.join(' | ')}]` : 'NONE')
  const samJob = top?.jobId === jobId
  console.log(samJob ? '✓ SAME Job offered — no duplicate spawned' : '✗ FAIL: first email’s Job not ranked first')

  // ── parse-quote discipline: key match vs fuzzy ──
  const k1 = await resolveCompanyByNameKey('ZZTEST Moonlight Pictures, Inc.')
  console.log('key-match check:', k1.matches.length === 1 && k1.matches[0].id === companyId ? '✓ exact single key match across suffix variants' : `✗ ${JSON.stringify(k1)}`)

  // ── cleanup by captured IDs ONLY ──
  const person = await prisma.person.findFirst({ where: { email: 'zztest.nightfall@example.test' }, select: { id: true } })
  await prisma.job.delete({ where: { id: jobId } }) // jobContacts cascade
  if (person) await prisma.person.delete({ where: { id: person.id } })
  await prisma.company.delete({ where: { id: companyId } })
  console.log('cleanup: job/person/company deleted by captured id')
}
main().finally(() => prisma.$disconnect())
