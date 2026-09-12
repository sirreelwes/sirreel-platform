/**
 * The co-branded masthead on partner mail (Wes 2026-09-11: "let's have the
 * shared logo header like we have for production companies … something that
 * communicates a partnership").
 *
 *   · partner mail carries BOTH marks; client mail is unchanged (ink band,
 *     SirReel wordmark centred) — the regression that matters, since every
 *     client template renders through the same shell.
 *   · no logo, or a VECTOR-only logo, falls back to the partner's NAME in
 *     type. Mail clients do not render SVG, so a vector mark in an <img> is a
 *     broken-image icon at the top of a first-contact email.
 *   · the logo url is absolute and public — a session-gated or token-gated
 *     one resolves to nothing from an inbox.
 *
 * Run: npm run test:partner-lockup
 */
import { renderEmailShell } from '@/lib/email/templates/shell'
import { partnerLogoEmailUrl } from '@/lib/sub-rentals/partnerLogo'
import { renderPartnerWelcome, buildPartnerWelcome } from '@/lib/sub-rentals/vendorInvite'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)
const no = (label: string, cond: boolean) => eq(label, cond, false)

// ── Which logo is safe to put in an inbox ───────────────────────────────────
const RASTER = { id: 'v1', logoUrl: 'https://blob.example/vendor-logos/v1/mark.png', logoSvg: null }
eq('raster mark → the public partner-logo route', partnerLogoEmailUrl(RASTER), 'https://hq.sirreel.com/api/public/partner-logo/v1')
eq('inline vector → no image at all', partnerLogoEmailUrl({ id: 'v1', logoUrl: 'https://blob.example/m.svg', logoSvg: '<svg/>' }), null)
eq('vector too big to inline is still a vector', partnerLogoEmailUrl({ id: 'v1', logoUrl: 'https://blob.example/m.SVG?x=1', logoSvg: null }), null)
eq('no logo on file', partnerLogoEmailUrl({ id: 'v1', logoUrl: null, logoSvg: null }), null)

// ── The introduction ────────────────────────────────────────────────────────
const intro = renderPartnerWelcome({
  vendorName: 'Saniset Fleet',
  subject: 'An introduction',
  body: 'Hi Rachel,\n\nWhat a pleasure to get to know you a little bit!',
  logoUrl: partnerLogoEmailUrl(RASTER),
})
yes('their mark is in the masthead', intro.html.includes('src="https://hq.sirreel.com/api/public/partner-logo/v1"'))
yes('their mark is labelled with their name', intro.html.includes('alt="Saniset Fleet"'))
yes('ours sits beside it, ink on white', intro.html.includes('/sirreel-logo.png'))
no('the SirReel-only ink band is gone', intro.html.includes('background:#0c0c0d;border-radius:10px 10px 0 0'))
yes('his words still come through', intro.html.includes('What a pleasure to get to know you a little bit!'))

const introNoLogo = renderPartnerWelcome({ vendorName: 'Saniset Fleet', subject: 'An introduction', body: 'Hi Rachel,', logoUrl: null })
no('no logo → no image to break', introNoLogo.html.includes('partner-logo'))
yes('no logo → their name holds the band', introNoLogo.html.includes('>Saniset Fleet</span>'))
yes('ours is still there', introNoLogo.html.includes('/sirreel-logo.png'))

// ── The account link ────────────────────────────────────────────────────────
const invite = buildPartnerWelcome({
  vendorName: 'PowerTrip Rentals',
  contactName: 'Evan Crawford',
  accountUrl: 'https://hq.sirreel.com/vendor/account/tok',
  unitCount: 4,
  agreementWaiting: true,
  senderName: 'Wes Bailey',
  sharePercent: 20,
  kind: 'EQUIPMENT',
  logoUrl: 'https://hq.sirreel.com/api/public/partner-logo/v2',
})
yes('the account mail wears the lockup too', invite.html.includes('api/public/partner-logo/v2'))
yes('and still carries the account link', invite.html.includes('https://hq.sirreel.com/vendor/account/tok'))

// ── Client mail is untouched ────────────────────────────────────────────────
const client = renderEmailShell({ heading: 'Your quote', bodyHtml: '<p>hi</p>' })
yes('client mail keeps the ink band', client.includes('background:#0c0c0d;border-radius:10px 10px 0 0'))
yes('client mail keeps the white wordmark', client.includes('/sirreel-logo-white.png'))
no('client mail names no partner', client.includes('partner-logo'))

console.log(fail === 0 ? '\nAll good.' : `\n${fail} failing.`)
process.exit(fail === 0 ? 0 : 1)
