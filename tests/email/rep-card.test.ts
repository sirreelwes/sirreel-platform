/**
 * Rep card tests — the face on client email.
 *
 *   npx tsx tests/email/rep-card.test.ts
 *   npm run test:rep-card
 *
 * Pure + offline. Three things are guarded here:
 *   1. WHERE THE PHOTO COMES FROM (pickRepPhoto) — the published "Who we
 *      are" roster row, and nothing else (Wes 2026-09-16: "for now let's
 *      just include the photos from who we are page"). The composer and the
 *      public image route must agree about it or an inbox shows a
 *      broken-image icon instead of a rep.
 *   2. That no photo means NO CARD — the welcome email has to come out
 *      byte-for-byte as it did before this shipped, for every job whose
 *      agent has not uploaded anything.
 *   3. The ROLLOUT gate — dark by default, testers only until Wes turns it
 *      on. Getting this backwards puts a photo in front of every client the
 *      day it deploys, which is the one outcome he asked to avoid.
 */
import {
  pickRepPhoto,
  repCardHtml,
  agentPhotoEmailUrl,
  type RepCard,
} from '../../src/lib/email/repCard'
import { repCardVisibleFor, isRepCardTester, maySendThankYou } from '../../src/lib/email/repCardRollout'
import { buildJobWelcomeEmail } from '../../src/lib/email/templates/jobWelcome'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}\n      got  ${g}\n      want ${w}`); failures.push(why) }
}
function ok(cond: boolean, why: string): void { eq(cond, true, why) }

console.log('pickRepPhoto — the Who-we-are photo, and only that')
eq(pickRepPhoto({ headshot: null }), null, 'no published roster photo → no photo, so no card')
eq(
  pickRepPhoto({ headshot: { id: 'h1' } }),
  { source: 'headshot', id: 'h1' },
  'a published roster photo carries the card',
)

console.log('\nagentPhotoEmailUrl')
const url = agentPhotoEmailUrl('user-1', 'c1')
ok(url.startsWith('https://'), 'absolute — a relative path resolves nowhere in a mail client')
ok(url.includes('/api/public/agent-photo/user-1'), 'points at the public proxy, not the private blob')
ok(url.includes('?v=c1'), 'pins which photo, so an old mail keeps its own picture')

console.log('\nrepCardHtml')
const card: RepCard = {
  name: 'Jose Pacheco',
  title: 'Sales',
  phone: '(747) 555-0142',
  email: 'jose@sirreel.com',
  photoUrl: agentPhotoEmailUrl('user-1', 'c1'),
}
const html = repCardHtml(card)
eq(repCardHtml(null), '', 'no rep → no card')
eq(repCardHtml({ ...card, photoUrl: null }), '', 'no photo → no card, not an initials chip')
ok(html.includes('width="72" height="72"'), 'both dimensions are set so a blocked image holds its box')
ok(html.includes('alt="Jose Pacheco"'), 'alt is the name — that is what a blocked inbox shows')
ok(html.includes('border-radius:8px'), 'rounded rectangle, not a circle Outlook would square')
ok(html.includes('#0F7A93'), 'turquoise accent')
ok(!html.includes('#c39a3f') && !html.includes('#D4A547'), 'no retired gold')
ok(html.includes('tel:7475550142'), 'tel: href is digits only')
ok(html.includes('Your SirReel rep'), 'the portal card wording, so the two surfaces agree')
ok(!repCardHtml({ ...card, title: null }).includes('Sales'), 'no title on file → the title line is omitted')

const esc = repCardHtml({ ...card, name: 'A & B <script>', title: '"Boss"' })
ok(esc.includes('A &amp; B &lt;script&gt;'), 'the name is escaped')
ok(esc.includes('&quot;Boss&quot;'), 'the title is escaped')

console.log('\nthe welcome email carries it')
const withCard = buildJobWelcomeEmail({
  jobName: 'Desigual x DL',
  body: 'Hi Marisol,\n\nGreat to have you on the books.',
  portalLink: 'https://hq.sirreel.com/portal/job/abc?token=T0K',
  repName: 'Jose Pacheco',
  repPhone: '(747) 555-0142',
  repEmail: 'jose@sirreel.com',
  rep: card,
})
ok(withCard.html.includes('Your SirReel rep'), 'the card renders in the welcome')
ok(
  withCard.html.indexOf('Your SirReel rep') < withCard.html.indexOf('Open your job'),
  'the card sits ABOVE the button, where it answers "who am I dealing with"',
)
ok(withCard.text.includes('Sales'), 'the plain-text half carries the title too')

const without = buildJobWelcomeEmail({
  jobName: 'Desigual x DL',
  body: 'Hi Marisol,\n\nGreat to have you on the books.',
  portalLink: 'https://hq.sirreel.com/portal/job/abc?token=T0K',
  repName: 'Jose Pacheco',
  repPhone: '(747) 555-0142',
  repEmail: 'jose@sirreel.com',
})
ok(!without.html.includes('Your SirReel rep'), 'no rep passed → the email is exactly what it was')
ok(without.html.includes('Jose Pacheco'), 'and it still signs off with the rep by name')
ok(
  buildJobWelcomeEmail({
    jobName: 'X', body: 'Hi,', portalLink: null, repName: 'R',
    rep: { ...card, photoUrl: null },
  }).html.includes('Your SirReel rep') === false,
  'a card with no photo renders nothing in the template either',
)

console.log('\nthe rollout gate — dark until Wes says so')
eq(repCardVisibleFor('jose@sirreel.com', false), false, 'dark: a rep\'s mail carries no card')
eq(repCardVisibleFor('oliver@sirreel.com', false), false, 'dark: nor the other rep\'s')
eq(repCardVisibleFor('wes@sirreel.com', false), true, 'dark: the tester\'s own jobs do')
eq(repCardVisibleFor('jose@sirreel.com', true), true, 'live: everyone')
eq(repCardVisibleFor('wes@sirreel.com', true), true, 'live: the tester too')
eq(repCardVisibleFor(null, false), false, 'no agent email → no card')
eq(repCardVisibleFor(undefined, false), false, 'undefined → no card')
eq(repCardVisibleFor('', true), true, 'live is live even with no agent email')

console.log('\nthe same switch holds the thank-you SEND')
eq(maySendThankYou('jose@sirreel.com', false), false, 'dark: a rep cannot send one yet')
eq(maySendThankYou('oliver@sirreel.com', false), false, 'dark: nor the other rep')
eq(maySendThankYou('wes@sirreel.com', false), true, 'dark: the tester can')
eq(maySendThankYou('jose@sirreel.com', true), true, 'live: the team can send')
eq(maySendThankYou(null, false), false, 'no session email → held')
eq(
  maySendThankYou('dani@sirreel.com', false),
  false,
  'dark: ADMIN is not the test — the copy is still PLACEHOLDER',
)

console.log('\nthe tester list is an EMAIL allowlist, not a role')
eq(isRepCardTester('wes@sirreel.com'), true, 'Wes')
eq(isRepCardTester('WES@SirReel.com'), true, 'case and stray case are normalised')
eq(isRepCardTester('  wes@sirreel.com  '), true, 'whitespace trimmed')
eq(
  isRepCardTester('dani@sirreel.com'),
  false,
  'Dani is ADMIN too — which is exactly why this is not a role check',
)
eq(isRepCardTester(null), false, 'null is not a tester')

if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\nall passed')
