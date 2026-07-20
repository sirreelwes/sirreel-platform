import { prisma } from '../src/lib/prisma'

const WES_PERSON_ID = '04a27d0d-52c3-4ee4-8520-ea5a5f219c37' // pre-existing Wes Bailey person — NEVER delete
const ACCOUNT_ID = '0c4b72f0-21f4-40e9-8a7e-98dfe5b2552c'    // info@sirreel.com EmailAccount — NEVER delete

async function main() {
  const wesUser = await prisma.user.findUnique({ where: { email: 'wes@sirreel.com' }, select: { id: true } })
  if (!wesUser) throw new Error('no wes user')

  const company = await prisma.company.create({
    data: { name: 'ZZTEST Nightfall Productions', tier: 'NEW', notes: 'ZZTEST step-4 hand-verification fixture — safe to delete' },
    select: { id: true, name: true },
  })

  const inquiryA = await prisma.inquiry.create({
    data: {
      source: 'MANUAL', status: 'NEW',
      title: 'ZZTEST Nightfall — Stage + Grip',
      description: [
        'ZZTEST fixture — hand-verification of the Job resolver (step 4). Safe to delete.',
        '',
        'Requested items:',
        '  • 2× Camera Cube — Aug 10–14',
        '  • 1× Cargo Van w/ Liftgate — Aug 10–14',
        'Contact: Wes Bailey <wes@sirreel.com>',
      ].join('\n'),
      companyId: company.id,
      personId: WES_PERSON_ID,
      estimatedValue: 4800,
      preferredStartDate: new Date('2026-08-10T00:00:00Z'),
      preferredEndDate: new Date('2026-08-14T00:00:00Z'),
      assignedToId: wesUser.id,
    },
    select: { id: true, title: true },
  })

  const inquiryB = await prisma.inquiry.create({
    data: {
      source: 'MANUAL', status: 'NEW',
      title: 'ZZTEST Nightfall — added pickup days',
      description: [
        'ZZTEST fixture #2 — the DUPLICATE-SHOOT second email. Same company, overlapping dates.',
        '',
        'Requested items:',
        '  • 1× Camera Cube — Aug 12–15',
        'Contact: Wes Bailey <wes@sirreel.com>',
      ].join('\n'),
      companyId: company.id,
      personId: WES_PERSON_ID,
      estimatedValue: 1600,
      preferredStartDate: new Date('2026-08-12T00:00:00Z'),
      preferredEndDate: new Date('2026-08-15T00:00:00Z'),
      assignedToId: wesUser.id,
    },
    select: { id: true, title: true },
  })

  const email = await prisma.emailMessage.create({
    data: {
      emailAccountId: ACCOUNT_ID,
      gmailMessageId: 'zztest-step4-quickreply-fixture',
      fromAddress: 'wes@sirreel.com',
      toAddresses: ['info@sirreel.com'],
      subject: 'ZZTEST stage + grip quote',
      snippet: 'ZZTEST — need 2 camera cubes + a cargo van with liftgate Aug 10–14 for ZZTEST Nightfall Productions…',
      bodyText: [
        'Hi team,',
        '',
        'ZZTEST fixture — this is a hand-verification email, reply goes to wes@sirreel.com only.',
        '',
        'We are ZZTEST Nightfall Productions, prepping a shoot called "Nightfall".',
        'Could you hold the following for Aug 10–14, 2026:',
        '  - 2x Camera Cube',
        '  - 1x Cargo Van w/ Liftgate',
        '',
        'Best,',
        'Wes Bailey',
        'ZZTEST Nightfall Productions',
        'wes@sirreel.com',
      ].join('\n'),
      bodySource: 'plain',
      direction: 'inbound',
      sentAt: new Date(),
      status: 'UNREAD',
      extractedData: {
        messageNature: 'inquiry',
        summary: 'ZZTEST fixture — quote request: 2x Camera Cube + 1x Cargo Van w/ Liftgate, Aug 10-14, ZZTEST Nightfall Productions',
        company: 'ZZTEST Nightfall Productions',
        contact: { name: 'Wes Bailey', email: 'wes@sirreel.com' },
        jobIntent: 'quote request',
        urgency: 'normal',
      },
      extractionConfidence: 0.95,
      extractionRunAt: new Date(),
    },
    select: { id: true, subject: true },
  })

  console.log(JSON.stringify({ companyId: company.id, inquiryA: inquiryA.id, inquiryB: inquiryB.id, emailMessageId: email.id }, null, 2))
}
main().finally(() => prisma.$disconnect())
