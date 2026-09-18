/**
 * "Is this job still open to client asks?" — the guard tests.
 *
 *   npx tsx tests/jobs/client-ask-guard.test.ts
 *   npm run test:client-ask-guard
 *
 * Pure + offline: clientAskBlock() takes a job shape and a clock, so the
 * whole rule is testable without a database.
 *
 * THE CASE THAT HAPPENED. On 2026-09-18 a rep pressed "Ask the client to
 * name the driver" on SR-JOB-0294 and a coordinator was emailed about a
 * shoot that ended on September 9th. Nothing on that job SAID it was
 * over — status NEW, not archived, not marked returned, its live order
 * still BOOKED. Only the dates knew. That exact row is the first test
 * below; if it ever passes the guard again, this file fails.
 *
 * Both failure directions matter equally:
 *   · a finished job slipping through   → a client gets mail about a
 *     shoot that is over, or a stranger gets the gate code
 *   · a LIVE job being refused          → the rep cannot do their job,
 *     and the truck goes out with nobody named on it
 *
 * The second is why the "nothing on the job yet" and "cancelled order
 * beside a live one" cases are here: an over-eager guard is a silent
 * outage on the ordinary path.
 */

import { clientAskBlock, type ClientAskCandidate } from '../../src/lib/jobs/clientAskGuard'

const NOW = new Date('2026-09-18T16:00:00.000Z') // ~9am Pacific
const d = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)

const failures: string[] = []

function eq(got: unknown, want: unknown, why: string): void {
  if (got === want) {
    console.log(`  ok — ${why}`)
  } else {
    console.log(`  FAIL — ${why}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
    failures.push(why)
  }
}

function job(over: Partial<ClientAskCandidate> = {}): ClientAskCandidate {
  return {
    id: 'j1',
    jobCode: 'SR-JOB-0294',
    name: 'RB SG Concealer Campaign',
    status: 'NEW',
    archivedAt: null,
    returnedAt: null,
    orders: [],
    bookings: [],
    ...over,
  }
}

const code = (j: ClientAskCandidate) => clientAskBlock(j, NOW)?.code ?? null

console.log('\nthe job that was actually mailed')
const grace = job({
  orders: [
    { status: 'DRAFT', startDate: d('2026-09-04'), endDate: d('2026-09-05') },
    { status: 'BOOKED', startDate: d('2026-09-04'), endDate: d('2026-09-09') },
  ],
})
eq(code(grace), 'past', 'SR-JOB-0294: status NEW, order still BOOKED, dates ended Sep 9')
eq(
  clientAskBlock(grace, NOW)?.endedOn,
  '2026-09-09',
  'names the day it ended, so the refusal can say it out loud',
)

console.log('\nthe explicit human markers')
eq(code(job({ archivedAt: new Date('2026-09-01') })), 'archived', 'archived')
eq(code(job({ status: 'LOST' })), 'lost', 'marked Lost')
eq(code(job({ status: 'WRAPPED' })), 'wrapped', 'marked Wrapped')
eq(code(job({ status: 'HOLD' })), 'hold', 'on Hold — paused is not a job to mail either')
eq(code(job({ returnedAt: new Date('2026-09-10') })), 'returned', 'marked returned')
// The markers outrank the dates: a job archived mid-rental is still closed.
eq(
  code(job({
    archivedAt: new Date('2026-09-17'),
    orders: [{ status: 'BOOKED', startDate: d('2026-09-17'), endDate: d('2026-09-25') }],
  })),
  'archived',
  'archived beats future dates',
)

console.log('\nthe date rule')
eq(
  code(job({ orders: [{ status: 'BOOKED', startDate: d('2026-09-15'), endDate: d('2026-09-18') }] })),
  null,
  'ends TODAY — still live; the last day is a working day',
)
eq(
  code(job({ orders: [{ status: 'BOOKED', startDate: d('2026-09-17'), endDate: d('2026-09-17') }] })),
  'past',
  'a one-day rental that was yesterday',
)
eq(
  code(job({ orders: [{ status: 'BOOKED', startDate: d('2026-10-01'), endDate: d('2026-10-04') }] })),
  null,
  'entirely in the future',
)
eq(
  code(job({ orders: [{ status: 'BOOKED', startDate: d('2026-09-01'), endDate: null }] })),
  'past',
  'no end date — the start date is the last thing we know',
)
// A second date block is exactly why the guard reads the LATEST end, not
// the first: a show that came back in August and goes out again in October
// is live, and its coordinator still needs to name a driver.
eq(
  code(job({
    orders: [
      { status: 'BOOKED', startDate: d('2026-08-01'), endDate: d('2026-08-05') },
      { status: 'BOOKED', startDate: d('2026-10-01'), endDate: d('2026-10-05') },
    ],
  })),
  null,
  'an old block beside an upcoming one — the latest date wins',
)

console.log('\ndead weight never extends a job')
eq(
  code(job({
    orders: [
      { status: 'BOOKED', startDate: d('2026-09-01'), endDate: d('2026-09-09') },
      { status: 'CANCELLED', startDate: d('2026-11-01'), endDate: d('2026-11-09') },
    ],
  })),
  'past',
  'a CANCELLED order dated in November does not keep the job open',
)
eq(
  code(job({
    orders: [{ status: 'BOOKED', startDate: d('2026-09-01'), endDate: d('2026-09-09') }],
    bookings: [{
      status: 'CANCELLED', startDate: d('2026-12-01'), endDate: d('2026-12-05'),
      items: [{ assignments: [{ status: 'ASSIGNED', startDate: d('2026-12-01'), endDate: d('2026-12-05') }] }],
    }],
  })),
  'past',
  'a cancelled BOOKING does not either',
)
eq(
  code(job({
    orders: [{ status: 'BOOKED', startDate: d('2026-09-01'), endDate: d('2026-09-09') }],
    bookings: [{
      status: 'CONFIRMED', startDate: d('2026-09-01'), endDate: d('2026-09-09'),
      items: [{ assignments: [{ status: 'SWAPPED', startDate: d('2026-12-01'), endDate: d('2026-12-05') }] }],
    }],
  })),
  'past',
  'a SWAPPED assignment is a unit that left the job — its dates do not count',
)
eq(
  code(job({ orders: [{ status: 'CANCELLED', startDate: d('2026-12-01'), endDate: d('2026-12-05') }] })),
  'cancelled',
  'everything cancelled — even dated in the future',
)

console.log('\na live booking keeps the job open when the orders look stale')
eq(
  code(job({
    orders: [{ status: 'BOOKED', startDate: d('2026-09-01'), endDate: d('2026-09-09') }],
    bookings: [{
      status: 'CONFIRMED', startDate: d('2026-09-20'), endDate: d('2026-09-25'),
      items: [{ assignments: [{ status: 'ASSIGNED', startDate: d('2026-09-20'), endDate: d('2026-09-25') }] }],
    }],
  })),
  null,
  'the scheduler holds a future block the orders have not caught up with',
)

console.log('\nthe ordinary path is not broken')
eq(code(job()), null, 'a job somebody is still building — no orders, no bookings, no dates')
eq(
  code(job({ status: 'QUOTED', orders: [{ status: 'QUOTE_SENT', startDate: null, endDate: null }] })),
  null,
  'a quote out with no dates on it yet',
)
eq(code(job({ status: 'ACTIVE' })), null, 'a legacy ACTIVE row with nothing on it')

console.log('\nthe refusal reads like a sentence')
const reason = clientAskBlock(grace, NOW)!.reason
eq(reason.includes('SR-JOB-0294'), true, 'names the job code')
eq(reason.includes('Sep 9'), true, 'names the day it ended')

console.log(failures.length ? `\n${failures.length} FAILED\n` : '\nall passed\n')
process.exit(failures.length ? 1 : 0)
