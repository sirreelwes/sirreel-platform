/**
 * Find a client's logo on their own website, from the domain their people
 * email us from.
 *
 * Wes 2026-09-14: "feature the company logo whenever we have it. If you can
 * pull it from their website (look at the email addresses to find) then we
 * can use that too." Measured 2026-09-12: only 3 companies have `website`
 * set, but 108 of the 220 logo-less active clients have a contact on a
 * non-freemail domain, and that domain is usually their site.
 *
 * Two halves, kept apart so the rules are testable without a network:
 *
 *   - PURE: `rankCompanyDomains` (which domain is theirs), `extractLogoCandidates`
 *     (where a page keeps its mark), `isLightMark` (a white logo made for a
 *     dark header vanishes on the portal's white masthead — refuse it).
 *   - NETWORK: `findLogoForDomain` fetches the home page and the candidates,
 *     with an SSRF guard on every hop — the domain comes from an email
 *     address anyone can type at us.
 *
 * A found logo is a SUGGESTION until a person has looked at it. The staff
 * button previews it; the backfill writes only ids a person picked off its
 * contact sheet. Measured on the live list 2026-09-14: of 36 finds whose
 * domain carried the company name, several were still somebody else's mark
 * (Amazon's for Seed Media Arts, Telemundo's for Latin Entertainment Works,
 * GoDaddy's placeholder for Worda). A wrong logo on a client's portal reads
 * as careless in a way the plain company name never does.
 */

import { inflateSync } from 'zlib'
import { lookup } from 'dns/promises'
import { isIP } from 'net'
import { FREEMAIL_DOMAINS, KNOWN_VENDOR_DOMAINS, SIRREEL_DOMAIN } from '@/lib/crm/captureConstants'

// ── Which domain is theirs ────────────────────────────────────────────────

/** Domains on production threads that are never the production company:
 *  payroll, accounting and studio-services shops CC'd on every show. */
export const SERVICE_DOMAINS: ReadonlySet<string> = new Set([
  'castandcrew.com',
  'ep.com',
  'entertainmentpartners.com',
  'wrapbook.com',
  'greenslate.com',
  'media-services.com',
  'mediaservices.com',
  'pay.com',
  'dockeysoftware.com',
  'studiobinder.com',
  'google.com',
  'googlemail.com',
  'ymail.com',
  'rocketmail.com',
  'att.net',
  'cox.net',
  'earthlink.net',
  'charter.net',
  'mail.com',
  'gmx.com',
  'zoho.com',
  'fastmail.com',
  'hey.com',
  'pm.me',
])

export function registrableDomain(host: string): string {
  const h = host.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  return h
}

/** Lowercased domain of an address or URL, '' when there is none. */
export function domainFromEmailOrUrl(v: string | null | undefined): string {
  if (!v) return ''
  const s = v.trim().toLowerCase()
  if (s.includes('@')) return registrableDomain(s.slice(s.lastIndexOf('@') + 1).replace(/[>\s].*$/, ''))
  try {
    const u = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`)
    return registrableDomain(u.hostname)
  } catch {
    return ''
  }
}

export function isOwnableDomain(d: string): boolean {
  if (!d || !d.includes('.')) return false
  if (d === SIRREEL_DOMAIN || d.endsWith(`.${SIRREEL_DOMAIN}`)) return false
  if (FREEMAIL_DOMAINS.has(d) || KNOWN_VENDOR_DOMAINS.has(d) || SERVICE_DOMAINS.has(d)) return false
  if (/\.(edu|gov|mil)$/.test(d)) return false
  return true
}

const NAME_STOPWORDS = new Set([
  'the', 'and', 'inc', 'llc', 'ltd', 'co', 'corp', 'company', 'productions', 'production',
  'prod', 'prods', 'films', 'film', 'pictures', 'media', 'studios', 'studio', 'group',
  'entertainment', 'creative', 'content', 'agency', 'la', 'usa', 'of',
])

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Does this domain visibly belong to this company name? "radicalmedia.com"
 * for "Radical Media", "happyplace.tv" for "Happy Place Inc". A distinctive
 * token (not "productions") must appear in the domain label, or the label
 * must be the name's initials ("mjz.com" for "MJZ"), or the whole squashed
 * name must be in the label.
 */
export function domainMatchesName(domain: string, companyName: string): boolean {
  const label = domain.split('.')[0].replace(/[^a-z0-9]/g, '')
  if (label.length < 2) return false
  const all = nameTokens(companyName)
  const squashed = all.join('')
  const distinctive = all.filter((t) => !NAME_STOPWORDS.has(t) && t.length >= 3)
  if (squashed.length >= 3 && label.includes(squashed)) return true
  // "radmedia" for "Radical Media Group" does not count, but the label being
  // the distinctive words run together does ("bigfish" for "Big Fish Ent.").
  const core = all.filter((t) => !NAME_STOPWORDS.has(t)).join('')
  if (core.length >= 4 && core.includes(label) && label.length >= 4 && !NAME_STOPWORDS.has(label)) return true
  if (distinctive.some((t) => label.includes(t))) return true
  const initials = all.filter((t) => !['the', 'and', 'of', 'inc', 'llc'].includes(t)).map((t) => t[0]).join('')
  return initials.length >= 2 && label === initials
}

export interface RankedDomain {
  domain: string
  /** How many distinct addresses on file use it. */
  count: number
  matchesName: boolean
  /** Where it came from — the company's own website field outranks email. */
  fromWebsite: boolean
}

/**
 * Rank the candidate domains for a company: its website field first, then
 * domains that match the company name, then by how many people use it.
 * Freemail, our own, known vendors and payroll shops are dropped.
 */
export function rankCompanyDomains(input: {
  companyName: string
  website?: string | null
  emails: Array<string | null | undefined>
}): RankedDomain[] {
  const byDomain = new Map<string, { addrs: Set<string>; fromWebsite: boolean }>()
  const site = domainFromEmailOrUrl(input.website)
  if (site && isOwnableDomain(site)) byDomain.set(site, { addrs: new Set(), fromWebsite: true })
  for (const e of input.emails) {
    const d = domainFromEmailOrUrl(e)
    if (!e || !d || !isOwnableDomain(d) || !e.includes('@')) continue
    const row = byDomain.get(d) ?? { addrs: new Set<string>(), fromWebsite: false }
    row.addrs.add(e.trim().toLowerCase())
    byDomain.set(d, row)
  }
  return Array.from(byDomain.entries())
    .map(([domain, r]) => ({
      domain,
      count: r.addrs.size,
      fromWebsite: r.fromWebsite,
      matchesName: domainMatchesName(domain, input.companyName),
    }))
    .sort(
      (a, b) =>
        Number(b.fromWebsite) - Number(a.fromWebsite) ||
        Number(b.matchesName) - Number(a.matchesName) ||
        b.count - a.count ||
        a.domain.localeCompare(b.domain),
    )
}

// ── Where a page keeps its mark ───────────────────────────────────────────

export type LogoVia = 'json-ld' | 'header-img' | 'logo-img' | 'apple-touch-icon' | 'og-logo'

/** Class/id/path words that mark somebody else's logo. */
const THIRD_PARTY_STRIP = /\blogos\b|client|partner|customer|sponsor|\bpress\b|award|featured|as-seen|brands?-(?:grid|list|strip)|marquee|carousel|slider|ticker/i

/** Site-builder stand-ins (GoDaddy's pwa-app/logo-default.png), not a brand. */
export const PLACEHOLDER = /logo-default|default-logo|placeholder|pwa-app\/|no-image|blank\.(png|gif)/i

/** A filename that says the mark is the light version. */
export const LIGHT_VARIANT = /[-_+ ./](white|light|reverse[d]?|inverse|inverted|knockout|neg(?:ative)?)(?=[-_+ .%/?]|$)/i

export interface LogoCandidate {
  url: string
  via: LogoVia
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  if (!m) return null
  return (m[2] ?? m[3] ?? m[4] ?? '').trim()
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/').replace(/&quot;/g, '"')
}

function absolutize(raw: string | null, base: string): string | null {
  if (!raw) return null
  const v = decodeEntities(raw.trim())
  if (!v || v.startsWith('data:')) return null
  try {
    const u = new URL(v, base)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

/** First usable URL in a srcset ("a.png 1x, b.png 2x" → the LAST, largest). */
function fromSrcset(srcset: string | null): string | null {
  if (!srcset) return null
  const parts = srcset.split(',').map((p) => p.trim().split(/\s+/)[0]).filter(Boolean)
  return parts[parts.length - 1] ?? null
}

/**
 * Every place the page advertises its logo, best first. Deliberately NOT
 * og:image — on most sites that is a hero photo or a social card, and a
 * photo in the masthead is worse than the name.
 */
export function extractLogoCandidates(html: string, baseUrl: string): LogoCandidate[] {
  const out: LogoCandidate[] = []
  const seen = new Set<string>()
  const push = (raw: string | null, via: LogoVia) => {
    const url = absolutize(raw, baseUrl)
    if (url && !seen.has(url)) {
      seen.add(url)
      out.push({ url, via })
    }
  }

  // 1. schema.org Organization.logo — the site telling us outright.
  for (const m of Array.from(html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi))) {
    const found: string[] = []
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) return n.forEach(walk)
      const o = n as Record<string, unknown>
      const logo = o.logo
      if (typeof logo === 'string') found.push(logo)
      else if (logo && typeof logo === 'object') {
        const l = logo as Record<string, unknown>
        if (typeof l.url === 'string') found.push(l.url)
        else if (typeof l.contentUrl === 'string') found.push(l.contentUrl)
      }
      Object.values(o).forEach((v) => typeof v === 'object' && walk(v))
    }
    try {
      walk(JSON.parse(m[1].trim()))
    } catch {
      /* malformed JSON-LD is common; skip it */
    }
    found.forEach((u) => push(u, 'json-ld'))
  }

  const logoish = (tag: string) =>
    /logo|brand/i.test(
      [attr(tag, 'class'), attr(tag, 'id'), attr(tag, 'alt'), attr(tag, 'src'), attr(tag, 'data-src')].join(' '),
    )
  // Measured on the live client list 2026-09-14: a production company's
  // page is full of OTHER companies' logos — "clients we've worked with"
  // strips served Spotify's mark for Daydream and Telemundo's for Latin
  // Entertainment Works. Anything that reads as a strip is refused.
  const stripish = (tag: string) =>
    THIRD_PARTY_STRIP.test(
      [attr(tag, 'class'), attr(tag, 'id'), attr(tag, 'src'), attr(tag, 'data-src'), attr(tag, 'srcset')].join(' '),
    )
  const imgSrc = (tag: string) =>
    stripish(tag) ? null : attr(tag, 'src') || attr(tag, 'data-src') || fromSrcset(attr(tag, 'srcset') || attr(tag, 'data-srcset'))

  // 2. An <img> inside <header> or an element whose class says logo.
  const header = html.match(/<header[\s\S]*?<\/header>/i)?.[0] ?? ''
  for (const tag of Array.from(header.matchAll(/<img\b[^>]*>/gi)).map((m) => m[0])) {
    if (logoish(tag)) push(imgSrc(tag), 'header-img')
  }
  // A logo wrapper (<a class="logo"><img …>) — the img itself is often bare.
  for (const m of Array.from(html.matchAll(/<(?:a|div|span|figure)\b([^>]*(?:class|id)\s*=\s*["'][^"']*logo[^"']*["'][^>]*)>([\s\S]{0,600}?)<\/(?:a|div|span|figure)>/gi))) {
    if (THIRD_PARTY_STRIP.test(m[1])) continue
    const img = m[2].match(/<img\b[^>]*>/i)?.[0]
    if (img) push(imgSrc(img), 'header-img')
  }
  // 3. An <img> whose class, id or alt calls it a logo — a filename alone is
  //    not enough (/logos/7.png is a client strip). First two only.
  let n = 0
  for (const tag of Array.from(html.matchAll(/<img\b[^>]*>/gi)).map((m) => m[0])) {
    const named = /logo/i.test([attr(tag, 'class'), attr(tag, 'id'), attr(tag, 'alt')].join(' '))
    if (named && !stripish(tag) && n++ < 2) push(imgSrc(tag), 'logo-img')
  }

  // 4. The apple-touch-icon: square and small, but the brand's own mark on
  //    an opaque plate, so it always reads on white. NOT the SVG favicon —
  //    on the live list those were monogram fragments, and blank where the
  //    icon recolours itself for dark mode.
  for (const tag of Array.from(html.matchAll(/<link\b[^>]*>/gi)).map((m) => m[0])) {
    const rel = (attr(tag, 'rel') || '').toLowerCase()
    if (rel.includes('apple-touch-icon')) push(attr(tag, 'href'), 'apple-touch-icon')
  }
  for (const tag of Array.from(html.matchAll(/<meta\b[^>]*>/gi)).map((m) => m[0])) {
    if ((attr(tag, 'property') || attr(tag, 'itemprop') || '').toLowerCase() === 'og:logo') push(attr(tag, 'content'), 'og-logo')
  }
  return out
}

// ── Would it vanish on white? ─────────────────────────────────────────────

const WHITEISH = /^(#fff|#ffffff|#fffffff?f|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|rgba\(\s*255\s*,\s*255\s*,\s*255\s*,[^)]*\))$/i

/** An SVG whose every painted colour is white. An unpainted shape with no
 *  fill inherited from the root or a stylesheet paints black, so it counts
 *  as dark. */
export function isLightSvg(svg: string): boolean {
  const colors: string[] = []
  for (const m of Array.from(svg.matchAll(/(?:fill|stroke|stop-color)\s*(?:=\s*["']([^"']+)["']|:\s*([^;}"']+))/gi))) {
    const c = (m[1] ?? m[2] ?? '').trim().toLowerCase()
    if (!c || c === 'none' || c === 'transparent' || c.startsWith('url') || c === 'inherit') continue
    colors.push(c.replace(/\s*!important$/, ''))
  }
  if (colors.length === 0) return false // default fill is black
  if (!colors.every((c) => WHITEISH.test(c))) return false
  const hasRootFill = /<svg\b[^>]*\sfill\s*=/i.test(svg) || /\{[^}]*fill\s*:/i.test(svg)
  const unpainted = /<(path|rect|circle|polygon|ellipse|text)\b(?![^>]*\s(fill|style|class)\s*=)[^>]*>/i.test(svg)
  return !(unpainted && !hasRootFill)
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/**
 * Mean luminance (0..1) of the visible pixels of an 8-bit PNG, and how much
 * of the image is transparent. Null for anything this small decoder does
 * not handle (16-bit, interlaced) — the caller then accepts the image.
 */
export function pngLightness(buf: Buffer): { luminance: number; transparentShare: number } | null {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null
  let pos = 8
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0
  let palette: Buffer | null = null
  let trns: Buffer | null = null
  const idat: Buffer[] = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      depth = data[8]; colorType = data[9]; interlace = data[12]
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (depth !== 8 || interlace !== 0 || !width || !height || width * height > 4_000_000) return null
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType]
  if (!channels || (colorType === 3 && !palette)) return null
  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(idat))
  } catch {
    return null
  }
  const stride = width * channels
  if (raw.length < (stride + 1) * height) return null
  const prev = Buffer.alloc(stride)
  const cur = Buffer.alloc(stride)
  let lumSum = 0, visible = 0, transparent = 0
  for (let y = 0; y < height; y++) {
    const off = y * (stride + 1)
    const filter = raw[off]
    for (let x = 0; x < stride; x++) {
      const v = raw[off + 1 + x]
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      cur[x] =
        filter === 0 ? v :
        filter === 1 ? v + a :
        filter === 2 ? v + b :
        filter === 3 ? v + ((a + b) >> 1) :
        v + paeth(a, b, c)
    }
    // Sample every pixel on small images, a grid on large ones.
    const step = Math.max(1, Math.floor(width / 200))
    for (let px = 0; px < width; px += step) {
      const i = px * channels
      let r: number, g: number, bl: number, al = 255
      if (colorType === 0) { r = g = bl = cur[i] }
      else if (colorType === 4) { r = g = bl = cur[i]; al = cur[i + 1] }
      else if (colorType === 2) { r = cur[i]; g = cur[i + 1]; bl = cur[i + 2] }
      else if (colorType === 6) { r = cur[i]; g = cur[i + 1]; bl = cur[i + 2]; al = cur[i + 3] }
      else {
        const idx = cur[i]
        r = palette![idx * 3]; g = palette![idx * 3 + 1]; bl = palette![idx * 3 + 2]
        al = trns && idx < trns.length ? trns[idx] : 255
      }
      if (al < 40) { transparent++; continue }
      visible++
      lumSum += (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255
    }
    cur.copy(prev)
  }
  const total = visible + transparent
  if (!total) return null
  return { luminance: visible ? lumSum / visible : 1, transparentShare: transparent / total }
}

/** A mark drawn light on a transparent plate — made for a dark header. */
export function isLightMark(bytes: Buffer, contentType: string): boolean {
  if (contentType === 'image/svg+xml') return isLightSvg(bytes.toString('utf8'))
  if (contentType === 'image/png') {
    const l = pngLightness(bytes)
    if (!l) return false
    if (l.transparentShare === 0 && l.luminance > 0.97) return true // a blank white square
    return l.transparentShare > 0.05 && l.luminance > 0.85
  }
  return false
}

// ── Network ───────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (compatible; SirReelHQ-logo/1.0; +https://hq.sirreel.com)'
const HTML_MAX = 1_500_000
export const LOGO_MAX_BYTES = 1_000_000

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase()
    if (v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80')) return true
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return mapped ? isPrivateAddress(mapped[1]) : false
  }
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  )
}

async function assertPublicHost(url: URL) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('not http(s)')
  if (url.port && url.port !== '443' && url.port !== '80') throw new Error('odd port')
  const host = url.hostname
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('private address')
    return
  }
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('local host')
  const addrs = await lookup(host, { all: true })
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('private address')
}

/** fetch with a timeout, a byte cap, and the SSRF check on every redirect. */
async function guardedFetch(start: string, maxBytes: number, accept: string): Promise<{ url: string; type: string; body: Buffer }> {
  let url = new URL(start)
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicHost(url)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    try {
      const res = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: accept } })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) throw new Error(`redirect without location`)
        url = new URL(loc, url)
        continue
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      const declared = Number(res.headers.get('content-length') || 0)
      if (declared > maxBytes) throw new Error('too large')
      const chunks: Uint8Array[] = []
      let size = 0
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) {
          await reader.cancel()
          throw new Error('too large')
        }
        chunks.push(value)
      }
      return {
        url: url.toString(),
        type: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(),
        body: Buffer.concat(chunks),
      }
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error('too many redirects')
}

/** Content type from the bytes — servers label logos wrongly all the time. */
export function sniffImageType(b: Buffer, declared: string): string | null {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  const head = b.subarray(0, 2000).toString('utf8')
  if (/<svg[\s>]/i.test(head) && !/<html[\s>]/i.test(head)) return 'image/svg+xml'
  return declared === 'image/svg+xml' && /<svg[\s>]/i.test(b.toString('utf8')) ? 'image/svg+xml' : null
}

export interface FoundLogo {
  domain: string
  pageUrl: string
  sourceUrl: string
  via: LogoVia
  contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml'
  bytes: Buffer
}

export interface LogoSearch {
  found: FoundLogo | null
  /** Why each candidate was passed over — shown on the dry run. */
  rejected: Array<{ url: string; why: string }>
  error?: string
}

/** Smallest acceptable raster edge. A 32px favicon blown up to the
 *  masthead is mush. */
const MIN_RASTER_EDGE = 96

function rasterSize(b: Buffer, type: string): { w: number; h: number } | null {
  if (type === 'image/png' && b.length >= 24) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  if (type === 'image/jpeg') {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null
      const marker = b[i + 1]
      const len = b.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
      }
      i += 2 + len
    }
  }
  if (type === 'image/webp' && b.length >= 30) {
    const fmt = b.toString('ascii', 12, 16)
    if (fmt === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
    if (fmt === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
    if (fmt === 'VP8L') {
      const bits = b.readUInt32LE(21)
      return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) }
    }
  }
  return null
}

export async function findLogoForDomain(domain: string): Promise<LogoSearch> {
  const rejected: LogoSearch['rejected'] = []
  let page: { url: string; type: string; body: Buffer } | null = null
  let lastErr = ''
  for (const start of [`https://${domain}/`, `https://www.${domain}/`]) {
    try {
      page = await guardedFetch(start, HTML_MAX, 'text/html,application/xhtml+xml')
      if (page.type && !page.type.includes('html')) {
        lastErr = `home page is ${page.type}`
        page = null
        continue
      }
      break
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }
  if (!page) return { found: null, rejected, error: `could not load ${domain}: ${lastErr}` }

  const candidates = extractLogoCandidates(page.body.toString('utf8'), page.url)
  for (const c of candidates.slice(0, 8)) {
    try {
      const got = await guardedFetch(c.url, LOGO_MAX_BYTES, 'image/svg+xml,image/png,image/jpeg;q=0.8,*/*;q=0.1')
      const type = sniffImageType(got.body, got.type)
      if (!type) {
        rejected.push({ url: c.url, why: `not a usable image (${got.type || 'unknown type'})` })
        continue
      }
      if (type !== 'image/svg+xml') {
        const size = rasterSize(got.body, type)
        if (size && Math.max(size.w, size.h) < MIN_RASTER_EDGE) {
          rejected.push({ url: c.url, why: `too small (${size.w}×${size.h})` })
          continue
        }
      }
      let path = c.url
      try {
        path = decodeURIComponent(new URL(c.url).pathname)
      } catch {
        /* keep the raw url */
      }
      if (PLACEHOLDER.test(path)) {
        rejected.push({ url: c.url, why: 'site-builder placeholder, not their mark' })
        continue
      }
      if (LIGHT_VARIANT.test(path)) {
        rejected.push({ url: c.url, why: 'filename says it is the white/light version' })
        continue
      }
      if (type === 'image/webp') {
        // No decoder here for the white-on-transparent test; a WEBP that
        // is not the site's opaque touch icon is too likely to be the
        // dark-header version to put on a white band unseen.
        if (c.via !== 'apple-touch-icon') {
          rejected.push({ url: c.url, why: 'WEBP logo — cannot check it reads on white' })
          continue
        }
      }
      if (isLightMark(got.body, type)) {
        rejected.push({ url: c.url, why: 'light mark for a dark background — invisible on white' })
        continue
      }
      return {
        found: {
          domain,
          pageUrl: page.url,
          sourceUrl: got.url,
          via: c.via,
          contentType: type as FoundLogo['contentType'],
          bytes: got.body,
        },
        rejected,
      }
    } catch (e) {
      rejected.push({ url: c.url, why: e instanceof Error ? e.message : String(e) })
    }
  }
  return { found: null, rejected, error: candidates.length ? 'no candidate passed' : 'no logo advertised on the page' }
}
