/**
 * Rep card tests — the face on client email.
 *
 *   npx tsx tests/email/rep-card.test.ts
 *   npm run test:rep-card
 *
 * Pure + offline. Two things are guarded here:
 *   1. The photo LADDER (pickRepPhoto), which the composer and the public
 *      image route both run. If they could disagree, an inbox would show a
 *      broken-image icon instead of a rep.
 *   2. That no photo means NO CARD — the welcome email has to come out
 *      byte-for-byte as it did before this shipped, for every job whose
 *      agent has not uploaded anything.
 */
import {
  pickRepPhoto,
  repCardHtml,
  agentPhotoEmailUrl,
  CANDID_FRESH_DAYS,
  type RepCard,
} from '../../src/lib/email/repCard'
import { buildJobWelcomeEmail } from '../../src/lib/email/templates/jobWelcome'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}\n      got  ${g}\n      want ${w}`); failures.push(why) }
}
function ok(cond: boolean, why: string): void { eq(cond, true, why) }

const NOW = new Date('2026-09-16T17:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

console.log('pickRepPhoto — the ladder')
eq(pickRepPhoto({ candid: null, headshot: null }, NOW), null, 'nothing on file → no photo, so no card')
eq(
  pickRepPhoto({ candid: { id: 'c1', capturedAt: daysAgo(2) }, headshot: { id: 'h1' } }, NOW),
  { source: 'candid', id: 'c1' },
  'a fresh candid beats the headshot — the candid is what Wes asked for',
)
eq(
  pickRepPhoto({ candid: { id: 'c1', capturedAt: daysAgo(CANDID_FRESH_DAYS + 1) }, headshot: { id: 'h1' } }, NOW),
  { source: 'headshot', id: 'h1' },
  'a stale candid loses to a curated headshot',
)
eq(
  pickRepPhoto({ candid: { id: 'c1', capturedAt: daysAgo(400) }, headshot: null }, NOW),
  { source: 'candid', id: 'c1' },
  'an old candid still beats nothing when there is no headshot',
)
eq(
  pickRepPhoto({ candid: null, headshot: { id: 'h1' } }, NOW),
  { source: 'headshot', id: 'h1' },
  'headshot alone carries the card',
)
eq(
  pickRepPhoto({ candid: { id: 'c1', capturedAt: daysAgo(CANDID_FRESH_DAYS) }, headshot: { id: 'h1' } }, NOW),
  { source: 'candid', id: 'c1' },
  'exactly at the freshness limit still counts as fresh',
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

if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\nall passed')
