/**
 * Logo-from-website rules — which domain is the client's, where a page keeps
 * its mark, and whether that mark would vanish on the portal's white band.
 *
 *   npx tsx tests/companies/logo-from-website.test.ts
 *   npm run test:logo-from-website
 *
 * Pure + offline: no DB, no network. The failure that matters is a WRONG
 * logo on a client's portal (a payroll company's, a white one nobody can
 * see), so most cases guard the refusals.
 */

import { deflateSync } from 'zlib'
import {
  domainMatchesName,
  extractLogoCandidates,
  isLightMark,
  isLightSvg,
  LIGHT_VARIANT,
  PLACEHOLDER,
  rankCompanyDomains,
  sniffImageType,
} from '../../src/lib/companies/logoFromWebsite'

const failures: string[] = []
function check(got: unknown, want: unknown, why: string) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`  ${ok ? 'ok' : 'FAIL'} — ${why}${ok ? '' : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`)
  if (!ok) failures.push(why)
}

console.log('domain ↔ name')
check(domainMatchesName('radicalmedia.com', 'Radical Media'), true, 'squashed name in the label')
check(domainMatchesName('happyplace.tv', 'Happy Place Inc'), true, 'suffix ignored')
check(domainMatchesName('mjz.com', 'MJZ'), true, 'short name, whole label')
check(domainMatchesName('smuggler.com', 'Smuggler Productions LLC'), true, 'distinctive token')
check(domainMatchesName('productions.com', 'Smuggler Productions'), false, '"productions" alone is not theirs')
check(domainMatchesName('castandcrew.com', 'Nightfall Films'), false, 'unrelated domain')

console.log('ranking')
const ranked = rankCompanyDomains({
  companyName: 'Nightfall Films',
  emails: [
    'pm@nightfallfilms.com',
    'ap@castandcrew.com',
    'coord@gmail.com',
    'a@showname-prod.com',
    'b@showname-prod.com',
    'wes@sirreel.com',
    null,
  ],
})
check(ranked.map((r) => r.domain), ['nightfallfilms.com', 'showname-prod.com'], 'payroll, freemail and ours dropped; name match beats count')
check(
  rankCompanyDomains({ companyName: 'X', website: 'https://www.example-co.com/about', emails: ['a@other.com', 'b@other.com'] })[0].domain,
  'example-co.com',
  'the website field outranks email',
)

console.log('candidates')
const html = `
<html><head>
<link rel="icon" href="/favicon.ico">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="https://cdn.example.com/touch.png">
<meta property="og:image" content="/hero.jpg">
<script type="application/ld+json">{"@type":"Organization","logo":{"@type":"ImageObject","url":"/brand/logo-ld.png"}}</script>
</head><body>
<header><a class="site-logo" href="/"><img src="/img/header.svg" alt="Home"></a></header>
<section><img class="client-logo" src="/partners/netflix.png"></section>
</body></html>`
const c = extractLogoCandidates(html, 'https://nightfallfilms.com/')
check(c[0], { url: 'https://nightfallfilms.com/brand/logo-ld.png', via: 'json-ld' }, 'JSON-LD first')
check(c[1], { url: 'https://nightfallfilms.com/img/header.svg', via: 'header-img' }, 'header logo wrapper second')
check(c.some((x) => x.url.endsWith('/hero.jpg')), false, 'og:image hero photo never offered')
check(c.some((x) => x.url.endsWith('/icon.svg')), false, 'SVG favicon not offered (monogram fragments)')
check(c.some((x) => x.via === 'apple-touch-icon' && x.url === 'https://cdn.example.com/touch.png'), true, 'apple-touch-icon offered')

const strip = extractLogoCandidates(
  `<body><div class="client-logos"><img class="logo" src="/logos/spotify.webp" alt="Spotify logo"></div>
   <section><img src="/images/logos/7.png"></section>
   <a class="navbar-logo" href="/"><img src="/img/daydream.svg"></a></body>`,
  'https://daydreamdoesit.com/',
)
check(strip.map((x) => x.url), ['https://daydreamdoesit.com/img/daydream.svg'], "a clients-we've-worked-with strip is not their logo")
check(LIGHT_VARIANT.test('/s/Wordmark_Neko_white.png'), true, '"_white" filename caught')
check(LIGHT_VARIANT.test('/s/Subplot Logo WHITE (Transparent).png'), true, '" WHITE " filename caught')
check(LIGHT_VARIANT.test('/img/lightbox-logo.png'), false, '"lightbox" is not "light"')
check(PLACEHOLDER.test('/isteam/ip/static/pwa-app/logo-default.png/:/rs=w:114'), true, "GoDaddy's placeholder refused")

console.log('light marks')
check(isLightSvg('<svg><path fill="#FFFFFF" d="M0"/><path fill="white" d="M1"/></svg>'), true, 'all-white SVG refused')
check(isLightSvg('<svg><path fill="#fff" d="M0"/><path fill="#0F7A93" d="M1"/></svg>'), false, 'white + colour kept')
check(isLightSvg('<svg><path d="M0"/></svg>'), false, 'unfilled paints black')
check(isLightSvg('<svg><style>.a{fill:#fff}</style><path class="a" d="M0"/></svg>'), true, 'white via stylesheet refused')

function png(w: number, h: number, rgba: [number, number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, cr])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  const rows: number[] = []
  for (let y = 0; y < h; y++) {
    rows.push(0)
    for (let x = 0; x < w; x++) {
      // left half transparent, right half the colour
      if (x < w / 2) rows.push(0, 0, 0, 0)
      else rows.push(...rgba)
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
check(isLightMark(png(120, 40, [255, 255, 255, 255]), 'image/png'), true, 'white on transparent PNG refused')
check(isLightMark(png(120, 40, [20, 30, 40, 255]), 'image/png'), false, 'dark on transparent PNG kept')
check(sniffImageType(png(4, 4, [0, 0, 0, 255]), 'text/html'), 'image/png', 'type sniffed from bytes, not the header')
check(sniffImageType(Buffer.from('<!doctype html><html><body>404</body></html>'), 'image/png'), null, 'an HTML 404 labelled image/png refused')

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`)
  process.exit(1)
}
console.log('\nall passed')
