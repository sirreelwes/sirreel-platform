/**
 * Merge-field rendering tests.
 *
 *   npm run test:merge-fields
 *
 * Pure + offline.
 *
 * The cases that matter are the FAILURES, not the happy path. A merge
 * that half-works is worse than one that refuses: "Hi , hope the shoot
 * went well" and "Hi {{first_name}}" both tell a producer exactly how
 * much attention we paid. Every one of these fixtures comes from a real
 * shape in the book — contacts with no company (97% of them until this
 * week), legacy rows whose lastName is ".", clients that have never
 * rented.
 */

import {
  renderForRecipient,
  resolveTokens,
  tokensUsed,
  looksLikeProductionCode,
  type RecipientContext,
} from '../../src/lib/outreach/mergeFields'

const failures: string[] = []
function check(cond: boolean, why: string) {
  console.log(cond ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!cond) failures.push(why)
}

const full: RecipientContext = {
  firstName: 'Emmett',
  lastName: 'Tekstra',
  companyName: 'MILE 44, Inc',
  lastKnownProject: 'Happy Place',
  companyLastRentalAt: new Date('2026-03-14T00:00:00Z'),
  senderName: 'Jose Pacheco',
}
const sparse: RecipientContext = {
  firstName: 'Ashley',
  lastName: '.',
  companyName: null,
  lastKnownProject: null,
  companyLastRentalAt: null,
  senderName: 'Jose Pacheco',
}

console.log('\nA fully-populated contact')
{
  const r = renderForRecipient(
    'Trucks for {{company}}?',
    'Hi {{first_name}},\n\nSince {{last_project}} wrapped we added stages.\n\n{{sender_first_name}}',
    full,
  )
  check(r.ok, 'renders')
  check(r.subject === 'Trucks for MILE 44, Inc?', 'subject merges the company')
  check(r.body.includes('Hi Emmett,'), 'greets by first name')
  check(r.body.includes('Since Happy Place wrapped'), 'uses the last known production')
  check(r.body.trim().endsWith('Jose'), 'signs off with the sender first name')
}

console.log('\nA sparse contact BLOCKS rather than degrading')
{
  const r = renderForRecipient('Trucks for {{company}}?', 'Hi {{first_name}},', sparse)
  check(!r.ok, 'refuses to send when a used token has no value')
  check(r.missing.includes('company'), 'and names the token that was missing')
  check(!r.body.includes('Hi ,'), 'never produces the blank-greeting failure')
}

console.log('\nConditionals let optional copy be omitted whole')
{
  const tmpl = 'Hi {{first_name}},{{#last_project}} Hope {{last_project}} wrapped well.{{/last_project}} Got a moment?'
  const rich = renderForRecipient('Hello', tmpl, full)
  check(rich.ok && rich.body.includes('Hope Happy Place wrapped well.'), 'the block renders when there is a value')
  const thin = renderForRecipient('Hello', tmpl, sparse)
  check(thin.ok, 'and the SAME copy still sends to a contact with no project')
  check(!thin.body.includes('Hope'), 'with the sentence removed entirely, not blanked')
  check(thin.body === 'Hi Ashley, Got a moment?', 'leaving clean copy behind')
}

console.log('\nLegacy name rows')
{
  const v = resolveTokens(sparse)
  check(v.last_name === null, 'a lastName of "." is treated as absent, not printed')
  check(v.full_name === 'Ashley', 'full_name degrades to just the first name')
}

console.log('\nDates and senders')
{
  const v = resolveTokens(full)
  check(v.last_rental_month === 'March', 'last rental month reads as a month name')
  check(v.sender_first_name === 'Jose', 'sender first name is derived from the full name')
  const noRental = resolveTokens({ ...full, companyLastRentalAt: null })
  check(noRental.last_rental_month === null, 'a client that never rented has no month')
}

console.log('\nProduction CODES are treated as no value, not merged into copy')
// Every string below is a real lastKnownProject from the book.
const CODES = ['P_EACC', 'TGOP', 'SB', 'KP', 'DBD', 'SLX', 'CHANNEL', 'LIETS',
  'DINER', 'VRBO', 'TOMS', '2606_Hercules Wave 1', '26007 Sony NFLP26',
  '161 - Recovery United', 'DSQ_MDM']
for (const c of CODES) {
  check(looksLikeProductionCode(c), `"${c}" is recognised as a code`)
}

console.log('\nReal titles are NOT mistaken for codes')
const TITLES = ['Game Changer S10', 'Magnopus', 'Team Win - Toyota Shoot',
  'Hungry Man - Kalshi', 'Lobo - Taco Bell LMC', "Audrey's School Camping Trip",
  'Meta Holiday', 'Accidentally Married to My Billionaire Boss', 'Happy Place']
for (const t of TITLES) {
  check(!looksLikeProductionCode(t), `"${t}" survives as a real title`)
}

console.log('\nThe code never reaches the copy')
{
  const withCode: RecipientContext = { ...full, lastKnownProject: 'DSQ_MDM' }
  const v = resolveTokens(withCode)
  check(v.last_project === null, 'a coded project resolves to no value')
  const tmpl = 'Hi {{first_name}},{{#last_project}} Hope {{last_project}} wrapped well.{{/last_project}} Got a moment?'
  const r = renderForRecipient('Hello', tmpl, withCode)
  check(r.ok, 'and the campaign still sends to them')
  check(!r.body.includes('DSQ_MDM'), 'with the code nowhere in the body')
  check(r.body === 'Hi Emmett, Got a moment?', 'the sentence is omitted whole, leaving clean copy')
}

console.log('\nAuthoring mistakes surface, they do not ship')
{
  const r = renderForRecipient('Hello', 'Hi {{frist_name}},', full)
  check(!r.ok, 'a typo\'d token blocks the send')
  check(r.body.includes('{{frist_name}}'), 'and stays visible in the preview so the rep sees it')
  const used = tokensUsed('Hi {{first_name}} at {{cmopany}}')
  check(used.known.includes('first_name'), 'known tokens are reported')
  check(used.unknown.includes('cmopany'), 'unknown ones are reported separately')
}

console.log('\nNo template, no tokens')
{
  const r = renderForRecipient('Plain subject', 'Plain body with no merge at all.', sparse)
  check(r.ok, 'copy with no tokens sends to anyone')
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):`)
  failures.forEach((f) => console.error(`  - ${f}`))
  process.exit(1)
}
console.log('\nAll merge-field tests passed.\n')
