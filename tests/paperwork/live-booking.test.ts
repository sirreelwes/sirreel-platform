/**
 * A client's paperwork link must survive a rebook.
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx tests/paperwork/live-booking.test.ts
 *   npm run test:live-paperwork
 *
 * Hits the live DB — there is no separate test database — so every row
 * it touches is created by this run under a ZZTEST_ prefix and deleted
 * by CAPTURED ID in the finally block. Nothing is ever matched by shape,
 * name, or entity scope (SHIPLOG "Hard Rules").
 *
 * The failure being pinned (Dunwell Productions, SR-JOB-0294,
 * 2026-09-04): the card-authorization link was emailed at 16:38:22 and
 * the booking it was minted against was cancelled at 16:39:13. The
 * client opened it to "Credit Card Authorization — Locked. This booking
 * is no longer active." with her truck going out the next morning. The
 * job was never cancelled; only the hold was, and a live reservation had
 * replaced it thirty-nine seconds later.
 */

import { PrismaClient } from '@prisma/client'
import {
  findLivePaperworkBooking,
  healPaperworkRequestBooking,
  adoptJobPaperworkRequest,
} from '../../src/lib/paperwork/livePaperworkBooking'

const prisma = new PrismaClient()

const failures: string[] = []
function check(cond: boolean, why: string, detail?: unknown): void {
  if (cond) console.log(`  ok — ${why}`)
  else {
    console.log(`  FAIL — ${why}${detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`)
    failures.push(why)
  }
}

// Every id this run creates. Cleanup deletes these and only these.
const made = {
  requests: [] as string[],
  bookings: [] as string[],
  jobs: [] as string[],
  people: [] as string[],
  companies: [] as string[],
}

const stamp = Date.now()
const day = (d: string) => new Date(`${d}T00:00:00.000Z`)

async function main() {
  // An agent User is required by Booking/Job and is NOT ours to create —
  // read an existing one and never write to it.
  const agent = await prisma.user.findFirst({ select: { id: true } })
  if (!agent) throw new Error('no User in the DB to hang a fixture booking on')

  const company = await prisma.company.create({
    data: { name: `ZZTEST_Paperwork_${stamp}` },
    select: { id: true },
  })
  made.companies.push(company.id)

  const person = await prisma.person.create({
    data: {
      firstName: 'ZZTEST',
      lastName: 'Coordinator',
      email: `zztest-paperwork-${stamp}@example.invalid`,
    },
    select: { id: true },
  })
  made.people.push(person.id)

  const job = await prisma.job.create({
    data: {
      jobCode: `ZZTEST-JOB-${stamp}`,
      name: `ZZTEST Rebook ${stamp}`,
      companyId: company.id,
      agentId: agent.id,
    },
    select: { id: true },
  })
  made.jobs.push(job.id)

  const mkBooking = async (n: string, status: 'REQUEST' | 'CANCELLED') => {
    const b = await prisma.booking.create({
      data: {
        bookingNumber: `ZZTEST-${stamp}-${n}`,
        companyId: company.id,
        personId: person.id,
        agentId: agent.id,
        jobId: job.id,
        jobName: `ZZTEST Rebook ${stamp}`,
        startDate: day('2026-09-04'),
        endDate: day('2026-09-05'),
        status,
      },
      select: { id: true },
    })
    made.bookings.push(b.id)
    return b.id
  }

  // The quote hold that was cancelled, and the reservation that replaced it.
  const retired = await mkBooking('retired', 'CANCELLED')
  const live = await mkBooking('live', 'REQUEST')

  const request = await prisma.paperworkRequest.create({
    data: { bookingId: retired, sentTo: `zztest-${stamp}@example.invalid` },
    select: { id: true, token: true },
  })
  made.requests.push(request.id)

  console.log("\nThe job's live booking is found past the retired one")
  {
    const found = await findLivePaperworkBooking(job.id, retired)
    check(found === live, 'the REQUEST booking wins, the CANCELLED one is skipped', { found, live })
  }

  console.log('\nOpening an orphaned link follows it onto the live booking')
  {
    const effective = await healPaperworkRequestBooking({
      id: request.id,
      bookingId: retired,
      booking: { status: 'CANCELLED', jobId: job.id },
    })
    check(effective === live, 'the portal is served the live booking, not a locked read-only shell')

    const row = await prisma.paperworkRequest.findUnique({
      where: { id: request.id },
      select: { bookingId: true, token: true },
    })
    check(row?.bookingId === live, 'the row is re-pointed, so portal WRITES land on the live booking too')
    check(row?.token === request.token, 'the token the client was emailed is unchanged — that is the whole point')

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'PaperworkRequest', entityId: request.id },
      orderBy: { createdAt: 'desc' },
      select: { oldValues: true },
    })
    check(
      (audit?.oldValues as { bookingId?: string } | null)?.bookingId === retired,
      'the move is audit-logged with the old booking id — reversible by captured id',
    )
  }

  console.log('\nA healthy link is never touched')
  {
    const effective = await healPaperworkRequestBooking({
      id: request.id,
      bookingId: live,
      booking: { status: 'REQUEST', jobId: job.id },
    })
    check(effective === live, 'a live booking resolves to itself')
    const audits = await prisma.auditLog.count({
      where: { entityType: 'PaperworkRequest', entityId: request.id },
    })
    check(audits === 1, 'no second move was written', { audits })
  }

  console.log('\nA genuinely finished job stays locked')
  {
    await prisma.booking.update({ where: { id: live }, data: { status: 'CANCELLED' } })
    const effective = await healPaperworkRequestBooking({
      id: request.id,
      bookingId: live,
      booking: { status: 'CANCELLED', jobId: job.id },
    })
    check(
      effective === live,
      'nothing live left on the job — the read-only lock is correct and stands',
    )
    await prisma.booking.update({ where: { id: live }, data: { status: 'REQUEST' } })
  }

  console.log('\nA staff re-send reuses the link the client already has')
  {
    // Put the request back on the retired booking to replay the send path.
    await prisma.paperworkRequest.update({
      where: { id: request.id },
      data: { bookingId: retired },
    })
    const adopted = await adoptJobPaperworkRequest(job.id, live)
    check(adopted?.token === request.token, 'no second token is minted — the client keeps one live link')
    check(adopted?.id === request.id, 'the card and signatures already on the row travel with it')

    const strays = await prisma.paperworkRequest.count({ where: { booking: { jobId: job.id } } })
    check(strays === 1, 'exactly one paperwork request on the job', { strays })
  }
}

main()
  .catch((e) => {
    console.error(e)
    failures.push(e instanceof Error ? e.message : String(e))
  })
  .finally(async () => {
    // Cleanup by CAPTURED ID only. The audit rows are addressed by the
    // request ids this run created, so they too are provably ours.
    for (const id of made.requests) {
      await prisma.auditLog.deleteMany({ where: { entityType: 'PaperworkRequest', entityId: id } })
      await prisma.paperworkRequest.deleteMany({ where: { id } })
    }
    for (const id of made.bookings) await prisma.booking.deleteMany({ where: { id } })
    for (const id of made.jobs) await prisma.job.deleteMany({ where: { id } })
    for (const id of made.people) await prisma.person.deleteMany({ where: { id } })
    for (const id of made.companies) await prisma.company.deleteMany({ where: { id } })
    await prisma.$disconnect()

    console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll passed')
    process.exit(failures.length ? 1 : 0)
  })
