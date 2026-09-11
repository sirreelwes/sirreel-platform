/**
 * The introduction email — their logo, their page link, his words.
 *
 *   npm run test:partner-welcome
 *
 * Pure + offline. Wes 2026-09-11: "I think we should include the partner's
 * logos in the intro email as well as the portal link … the sooner we get info
 * to them the better!" — which reverses the 09-10 rule that the introduction
 * carried no link.
 *
 * What must stay true: the body is HIS, escaped, never interpreted as HTML;
 * the link comes from the renderer, so the AI drafting still cannot invent one.
 */
import { renderPartnerWelcome } from '../../src/lib/sub-rentals/vendorInvite'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  if (got === want) console.log(`  ok — ${why}`)
  else failures.push(`${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

const URL = 'https://hq.sirreel.com/vendor/account/abc123'
const LOGO = 'https://hq.sirreel.com/api/public/vendor-account/abc123/logo'
const base = { vendorName: 'VSM Planet', subject: 'SirReel wants to be your outside sales partner!', body: 'Good speaking with you.\n\nHere is how it would work.' }

console.log('With a link and a logo')
const full = renderPartnerWelcome({ ...base, accountUrl: URL, logoUrl: LOGO })
eq(full.html.includes(`href="${URL}"`), true, 'the page link is in the mail')
eq(full.html.includes('Open your partner page'), true, 'as a button')
eq(full.html.includes(`>${URL}<`), false, 'and NOT written out as a raw address — the button is the link')
eq(full.html.includes(`src="${LOGO}"`), true, 'their logo is at the top')
eq(full.html.includes('alt="VSM Planet"'), true, 'the logo is labelled with their name')
eq(full.text.includes(`Your partner page: ${URL}`), true, 'the plain-text half carries the link too')
eq(full.text.includes('Good speaking with you.'), true, 'his words are in the text half')

console.log('Without either')
const bare = renderPartnerWelcome(base)
eq(bare.html.includes('Open your partner page'), false, 'no button when there is no link')
eq(bare.html.includes('<img src="https://hq.sirreel.com/api/public'), false, 'no logo when we hold none')
eq(bare.text.includes('Your partner page:'), false, 'and none in the text half')

console.log('His words stay his')
const sneaky = renderPartnerWelcome({ ...base, body: 'Hello <script>alert(1)</script> & thanks', accountUrl: URL })
eq(sneaky.html.includes('<script>'), false, 'markup in the body is escaped, not run')
eq(sneaky.html.includes('&lt;script&gt;'), true, 'it renders as the characters he typed')

if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\nall introduction checks passed')
