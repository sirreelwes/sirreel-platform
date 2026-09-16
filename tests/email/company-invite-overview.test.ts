/**
 * Company-portal invite — the overview variant.
 *
 *   npx tsx tests/email/company-invite-overview.test.ts
 *   npm run test:company-invite
 *
 * Pure + offline. Wes 2026-09-16 asked for "a version of the invite for
 * company portals that gives a high-level, bullet-pointed overview of the
 * innovation SirReel has implemented and highlights that they are being
 * offered these rates for their teams."
 *
 * Three things are guarded:
 *   1. NO FIGURES. This is the load-bearing one. The mail says a deal exists
 *      and that it reaches every team; it never prints a rate. Email
 *      forwards, and the share template in the same file already holds this
 *      line — "a negotiated rate in a forwarded mail is a rate card in the
 *      wild."
 *   2. No rates on file → no rates line. Promising an account a deal nobody
 *      struck is a lie the first quote exposes.
 *   3. The standard variant is untouched, byte for byte.
 *
 * Plus the TONE, which Wes set on 2026-09-16: "something we have added for
 * them that requires nothing from them. It's casual." So the copy is also
 * checked for the vendor words that creep back in on every edit, and for the
 * "nothing for you to set up" promise that is the whole point of the mail.
 */
import {
  renderCompanyPortalInvite,
  defaultCompanyPortalInviteBody,
  SIRREEL_CAPABILITIES,
  type CompanyPortalInviteInput,
} from '../../src/lib/email/templates/companyPortal'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}\n      got  ${g}\n      want ${w}`); failures.push(why) }
}
function ok(cond: boolean, why: string): void { eq(cond, true, why) }

const base: CompanyPortalInviteInput = {
  firstName: 'Nancy',
  companyName: 'Ding Ding Productions',
  portalUrl: 'https://hq.sirreel.com/portal/company/abc',
  repName: 'Jose Pacheco',
  repEmail: 'jose@sirreel.com',
}

// The rates highlight, matched on its own wording so a copy edit that drops
// the promise fails loudly rather than quietly shipping without it.
const RATES_LINE = /your rates come with it/i

const standard = renderCompanyPortalInvite(base)
const overview = renderCompanyPortalInvite({ ...base, variant: 'overview', hasNegotiatedRates: true })
const noRates = renderCompanyPortalInvite({ ...base, variant: 'overview', hasNegotiatedRates: false })

console.log('the overview carries the bullets')
ok(SIRREEL_CAPABILITIES.length >= 5, 'there is an actual list to show')
for (const line of SIRREEL_CAPABILITIES) {
  const lead = line.replace(/<[^>]+>/g, '').split('.')[0]
  ok(overview.html.includes(lead), `html carries: ${lead}`)
  ok(overview.text.includes(lead), `text carries it too: ${lead}`)
}
ok(!standard.html.includes(SIRREEL_CAPABILITIES[0].replace(/<[^>]+>/g, '').split('.')[0]),
  'the standard invite does NOT — this is a separate version, not a rewrite')

console.log('\nthe rates highlight')
ok(RATES_LINE.test(overview.html), 'html says the rates follow the account')
ok(/every production your company books/i.test(overview.html), 'and that it reaches every team, not just this show')
ok(/without having to ask/i.test(overview.html), 'and that adding people needs nothing from us')
ok(RATES_LINE.test(overview.text), 'the plain-text half says it too')
ok(overview.html.includes('Ding Ding Productions'), 'it names the company')

console.log('\nno rates on file → no promise')
ok(!RATES_LINE.test(noRates.html), 'html omits the rates line entirely')
ok(!RATES_LINE.test(noRates.text), 'text omits it too')
const firstLead = SIRREEL_CAPABILITIES[0].replace(/<[^>]+>/g, '').split('.')[0]
ok(noRates.html.includes(firstLead), 'the rest of the overview still sends')

console.log('\nNO FIGURES REACH THIS MAIL')
// A rate would show up as a currency amount, a bare decimal or a percentage.
// Test what a READER sees — stripping tags also strips the style attributes,
// which are full of decimals (line-height:1.55) and percents (width:50%) that
// are layout, not money.
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
const money = /\$\s?\d|\b\d+\.\d{2}\b|\bper day\b|\d+\s*%/i
for (const [name, mail] of [['overview', overview], ['no-rates', noRates], ['standard', standard]] as const) {
  ok(!money.test(visible(mail.html)), `${name} html shows no figure to a reader`)
  ok(!money.test(mail.text), `${name} text carries no figure`)
}
// And prove the check can actually fail, so a green line means something.
ok(money.test(visible('<p style="line-height:1.55">Cube truck, $450 per day</p>')),
  'the figure check catches a real rate (and ignores the CSS beside it)')

console.log('\nthe tone Wes asked for')
const overviewText = overview.text
ok(
  /nothing for you to set up/i.test(overviewText),
  'it says outright that nothing is required of them',
)
ok(
  /no login|nothing to install|without having to ask/i.test(overviewText),
  'and keeps saying it — no login, nothing to install',
)
// Pain first: the opening clause of each bullet should name a headache, not
// a feature. Cheap proxy — a feature list reaches for these words, a
// conversation does not.
const vendorSpeak = /\b(solution|platform|seamless|leverage|robust|best-in-class|streamlin\w*|empower\w*|cutting[- ]edge|synerg\w*)\b/i
ok(!vendorSpeak.test(overviewText), 'no vendor-brochure words')
ok(vendorSpeak.test('our seamless platform empowers you'), 'and that check can fail')
ok(/'|\u2019/.test(overviewText), 'contractions — it reads spoken, not drafted')
ok(overview.subject.length < 60, `subject stays short: "${overview.subject}"`)

console.log('\nthe standard variant is untouched')
const standardAgain = renderCompanyPortalInvite({ ...base, variant: 'standard' })
eq(standardAgain.html, standard.html, 'naming the variant explicitly changes nothing')
eq(standardAgain.subject, 'Your Ding Ding Productions account portal at SirReel', 'its subject is the original')
ok(overview.subject !== standard.subject, 'the overview gets its own subject')

console.log('\nthe seeded compose box')
const seed = defaultCompanyPortalInviteBody({ ...base, variant: 'overview' })
ok(seed.startsWith('Nancy,'), 'opens with the recipient')
ok(
  !SIRREEL_CAPABILITIES.some((c) => seed.includes(c.replace(/<[^>]+>/g, '').split('.')[0])),
  'the bullets are NOT in the editable prose — the renderer adds them, so an edit cannot drop them',
)
ok(!/\[.*bullets.*\]/i.test(seed), 'and no placeholder marker that would ship verbatim if edited')

console.log('\nan edited message keeps the blocks')
const edited = renderCompanyPortalInvite({
  ...base,
  variant: 'overview',
  hasNegotiatedRates: true,
  customBody: 'Nancy — good speaking today. Here is the account.',
})
ok(edited.html.includes('good speaking today'), "the rep's words are in")
ok(edited.html.includes(firstLead), 'the bullets survive the edit')
ok(RATES_LINE.test(edited.html), 'so does the rates note')

if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\nall passed')
