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
  clip,
  composeAlert,
  composeNudge,
  composeTestAlert,
  inTextingWindow,
  splitTitle,
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

console.log('\nwho — the linked records, else the title (59% of real rows have neither)')
{
  eq(who(lead()), 'Jane Doe · Acme Pictures', 'person and company')
  eq(who(lead({ companyName: null })), 'Jane Doe', 'person only')
  eq(who(lead({ personName: null })), 'Acme Pictures', 'company only')
  eq(
    who(lead({ personName: null, companyName: null, title: 'Production request — Halogen Cinema · Make You' })),
    'Halogen Cinema · Make You',
    'NOTHING linked → the identity out of the title, never "no name given"',
  )
  eq(who(lead({ personName: null, companyName: null, title: 'Contact — Drew' })), 'Drew', 'a bare contact form names Drew')
  eq(who(lead({ personName: null, companyName: null, title: 'Bozoma' })), 'Bozoma', 'a title with no kind prefix is used whole (public/intake)')
}

console.log('\nsplitTitle — the real shapes the forms produce')
{
  eq(splitTitle('Production request — Halogen Cinema · Make You'), { kind: 'Production request', identity: 'Halogen Cinema · Make You' }, 'supply-request')
  eq(splitTitle('Contact — Drew'), { kind: 'Contact', identity: 'Drew' }, 'public contact')
  eq(splitTitle('Add-on request — Blue Yonder'), { kind: 'Add-on request', identity: 'Blue Yonder' }, 'portal add-on')
  eq(splitTitle('After-hours assistant — Marco'), { kind: 'After-hours assistant', identity: 'Marco' }, "AHA's own callback")
  eq(splitTitle('Bozoma'), { kind: null, identity: 'Bozoma' }, 'no em-dash → no kind')
  eq(splitTitle('Some very long sentence that happens to contain an em-dash — and a tail'), { kind: null, identity: 'Some very long sentence that happens to contain an em-dash — and a tail' }, 'prose is not a kind label')
  eq(splitTitle('Contact — '), { kind: null, identity: 'Contact —' }, 'an empty identity is not a split')
}

console.log('\nthe unlinked case reads properly end to end')
{
  const unlinked = lead({ personName: null, companyName: null, title: 'Production request — Halogen Cinema · Make You' })
  const body = composeAlert([unlinked], APP)
  ok(!body.includes('no name given'), 'never "no name given" when the title names them')
  ok(body.includes('new incoming, Production request: Halogen Cinema · Make You'), 'kind says where it came from, identity says who')
  ok(!body.includes('Halogen Cinema · Make You — Halogen'), 'and the identity is not printed twice')

  const batch = composeAlert([unlinked, lead({ id: 'b', personName: null, companyName: null, title: 'Contact — Drew' })], APP)
  ok(batch.includes('Halogen Cinema · Make You; Drew'), 'a batch of unlinked rows still names them')
}

console.log('\nclipping')
{
  eq(clip('  Need   a  truck \n soon '), 'Need a truck soon', 'whitespace collapsed')
  const long = clip('x'.repeat(200))
  ok(long.length === 70 && long.endsWith('…'), 'a runaway field is capped at 70 with an ellipsis')
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

console.log('\nthe nudge — one follow-up when nobody replied (Wes 2026-09-12)')
{
  const one = composeNudge([lead()], APP, 1)
  ok(one.includes('still no reply after an hour'), 'an hour reads as words, not "1 hours"')
  ok(one.includes('Jane Doe · Acme Pictures'), 'names who is waiting')
  ok(one.includes(`${APP}/inquiries/clx123`), 'a single nudge still links that lead')
  ok(one.startsWith('AHA') && one.includes('SirReel'), 'name and brand, same as the alert')
  ok(!one.includes('new incoming'), 'it does not repeat the pitch — what is new is the waiting')

  const many = composeNudge([lead(), lead({ id: 'b', personName: 'Bob Smith', companyName: 'Netflix' })], APP, 3.4)
  ok(many.includes('2 still unanswered after 3 hours'), 'a batch counts them and rounds the wait')
  ok(many.includes(`${APP}/jobs?panel=incoming`), 'a batch links the Incoming panel')

  const three = composeNudge([lead(), lead({ id: 'b' }), lead({ id: 'c' })], APP, 2)
  ok(three.includes('+1 more'), 'first two named, the rest counted')
  ok(composeNudge([lead()], APP, 1.9).includes('an hour'), 'under two hours still reads "an hour"')
  ok(composeNudge([lead()], APP, 2).includes('2 hours'), 'two hours reads as a number')
}

console.log(failures.length ? `\n${failures.length} FAILED\n` : '\nall passed\n')
process.exit(failures.length ? 1 : 0)
