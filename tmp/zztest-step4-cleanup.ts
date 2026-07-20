/**
 * ZZTEST step-4 fixture cleanup — deletes ONLY the hand-verification
 * fixtures (captured IDs below) plus children created during the test
 * under the fixture company (provably fixture-owned: the company itself
 * is a fixture, so every job/order/booking beneath it is test-born).
 * NEVER touches: the pre-existing Wes Bailey person, the info@ email
 * account, or any row outside the captured-ID scope.
 */
import { prisma } from '../src/lib/prisma'

const COMPANY_ID = 'bd1af800-1e95-4ad0-ae1a-19509f4e758b' // ZZTEST Nightfall Productions
const INQUIRY_IDS = ['cmrkw3wio0001ca89cktyejtg', 'cmrkw3wly0003ca89ewg1tj5b']
const EMAIL_MESSAGE_ID = 'c9c02d02-b452-425e-ac06-889505b513fc'

async function step(label: string, fn: () => Promise<unknown>) {
  try {
    const r = await fn()
    console.log(`✓ ${label}`, typeof r === 'object' && r && 'count' in (r as object) ? `(${(r as { count: number }).count})` : '')
  } catch (e) {
    console.warn(`✗ ${label} —`, e instanceof Error ? e.message.split('\n')[0] : e)
  }
}

async function main() {
  const jobs = await prisma.job.findMany({ where: { companyId: COMPANY_ID }, select: { id: true, jobCode: true, name: true } })
  console.log('fixture-company jobs found:', jobs.map((j) => `${j.jobCode} ${j.name}`).join(', ') || 'none')
  const jobIds = jobs.map((j) => j.id)

  // Inquiries first (clears WelcomeInvites via cascade and the
  // convertedJobId FK that would block job deletion).
  await step('inquiries', () => prisma.inquiry.deleteMany({ where: { id: { in: INQUIRY_IDS } } }))
  // Bookings/holds made during the test (BookingItems + mirrors cascade).
  await step('bookings', () => prisma.booking.deleteMany({ where: { OR: [{ jobId: { in: jobIds } }, { companyId: COMPANY_ID }] } }))
  // Orders (line items / agreements / magic links cascade).
  await step('orders', () => prisma.order.deleteMany({ where: { OR: [{ jobId: { in: jobIds } }, { companyId: COMPANY_ID }] } }))
  // Paperwork requests hang off orders (cascaded) — jobs next (JobContacts cascade).
  await step('jobs', () => prisma.job.deleteMany({ where: { id: { in: jobIds } } }))
  // The seeded inbound email (any Gmail-synced outbound replies to wes@ are left alone).
  await step('email message', () => prisma.emailMessage.deleteMany({ where: { id: EMAIL_MESSAGE_ID } }))
  // CRM capture during a completed send may have affiliated Wes ↔ ZZTEST co.
  await step('affiliations', () => prisma.affiliation.deleteMany({ where: { companyId: COMPANY_ID } }))
  await step('company', () => prisma.company.delete({ where: { id: COMPANY_ID } }))

  const leftJobs = await prisma.job.count({ where: { companyId: COMPANY_ID } }).catch(() => 0)
  const leftCo = await prisma.company.count({ where: { id: COMPANY_ID } })
  console.log(leftCo === 0 && leftJobs === 0 ? 'CLEAN — all fixtures removed' : `LEFTOVERS: company=${leftCo} jobs=${leftJobs} — rerun or inspect`)
}
main().finally(() => prisma.$disconnect())
