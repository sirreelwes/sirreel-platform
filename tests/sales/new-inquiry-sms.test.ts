/**
 * AHA's "new incoming" alert — the words and the clock.
 *
 *   npx tsx tests/sales/new-inquiry-sms.test.ts
 *   npm run test:new-inquiry-sms
 *
 * Pure + offline. What this guards, in order of how badly it would hurt:
 *
 *   1. The LINK. The whole ask was "drop a link in the text to open that
 *      response" — a single lead must link that lead's own page, not the
 *      board.
 *   2. The WINDOW. 8am–10pm Pacific, DST included. Getting this wrong is a
 *      2am buzz.
 *   3. The BRAND. The carrier campaign filed that every message names the
 *      company; dropping "SirReel" from the body is a compliance change,
 *      not a copy tweak.
 */
import {
  composeAlert,
  composeTestAlert,
  inTextingWindow,
  trimTitle,
  who,
  type AlertSubject,
} from '../../src/lib/sales/newInquiryAlertText'

const APP = 'https://hq.sirreel.com'
const failures: string[] = []

function ok(cond: boolean, why: string): void {
  if (cond) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}`); failures.push(why) }
}
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}\n      got  ${g}\n      want ${w}`); failures.push(why) }
}

const lead = (over: Partial<AlertSubject> = {}): AlertSubject => ({
  id: 'clx123',
  title: 'Need a 3-ton grip truck Sep 20-24',
  personName: 'Jane Doe',
  companyName: 'Acme Pictures',
  ...over,
})

console.log('\nthe link — one lead opens that lead')
{
  const body = composeAlert([lead()], APP)
  ok(body.includes(`${APP}/inquiries/clx123`), 'a single incoming links its own inquiry page')
  ok(!body.includes('panel=incoming'), 'and does NOT fall back to the board')
}

console.log('\nthe link — a batch opens the Incoming panel')
{
  const body = composeAlert([lead(), lead({ id: 'b', personName: 'Bob Smith', companyName: 'Netflix' })], APP)
  ok(body.includes(`${APP}/jobs?panel=incoming`), 'two or more link the Incoming panel')
  ok(!body.includes('/inquiries/'), 'a batch never links one lead at the expense of the others')
  ok(body.startsWith('AHA'), 'the batch is still from AHA')
  ok(body.includes('2 new incoming'), 'and leads with the count')
}

console.log('\nthe batch names the first two and counts the rest')
{
  const many = ['a', 'b', 'c', 'd'].map((id) => lead({ id, personName: `P${id}`, companyName: null }))
  const body = composeAlert(many, APP)
  ok(body.includes('Pa; Pb'), 'first two named')
  ok(body.includes('+2 more'), 'the rest counted, not listed')
}

console.log('\nthe brand — filed with the carrier, not decoration')
{
  ok(composeAlert([lead()], APP).includes('SirReel'), 'single alert names SirReel')
  ok(composeAlert([lead(), lead({ id: 'b' })], APP).includes('SirReel'), 'batch alert names SirReel')
  ok(composeTestAlert(APP).includes('SirReel'), 'the test text names SirReel')
}

console.log('\nwho — degrades without throwing')
{
  eq(who(lead()), 'Jane Doe · Acme Pictures', 'person and company')
  eq(who(lead({ companyName: null })), 'Jane Doe', 'person only')
  eq(who(lead({ personName: null })), 'Acme Pictures', 'company only')
  eq(who(lead({ personName: null, companyName: null })), 'no name given', 'a bare web-form submission still sends')
}

console.log('\ntitle trimming')
{
  eq(trimTitle('  Need   a  truck \n soon '), 'Need a truck soon', 'whitespace collapsed')
  const long = trimTitle('x'.repeat(200))
  ok(long.length === 70 && long.endsWith('…'), 'a runaway subject is capped at 70 with an ellipsis')
}

console.log('\nthe window — 8am to 10pm Pacific')
{
  // PDT (UTC-7) in September.
  ok(!inTextingWindow(new Date('2026-09-11T14:59:00Z')), '7:59am PDT — held')
  ok(inTextingWindow(new Date('2026-09-11T15:00:00Z')), '8:00am PDT — sends')
  ok(inTextingWindow(new Date('2026-09-11T04:59:00Z')), '9:59pm PDT — sends')
  ok(!inTextingWindow(new Date('2026-09-11T05:00:00Z')), '10:00pm PDT — held')
  ok(!inTextingWindow(new Date('2026-09-11T09:14:00Z')), '2:14am PDT — held, which is the whole point')

  // PST (UTC-8) in January — the same wall-clock hours, an hour later in UTC.
  ok(!inTextingWindow(new Date('2026-01-15T15:59:00Z')), '7:59am PST — held through the DST change')
  ok(inTextingWindow(new Date('2026-01-15T16:00:00Z')), '8:00am PST — sends through the DST change')
  ok(!inTextingWindow(new Date('2026-01-15T06:00:00Z')), '10:00pm PST — held through the DST change')
}

console.log(failures.length ? `\n${failures.length} FAILED\n` : '\nall passed\n')
process.exit(failures.length ? 1 : 0)
