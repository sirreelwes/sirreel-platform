/**
 * End-to-end stage-contract signing test.
 *
 * Drives the REAL HTTP endpoints against a local dev server (which talks
 * to the same Neon database as production), rather than calling the
 * library functions directly — the point is to exercise the routes'
 * auth, validation and error handling, not just the PDF renderer.
 *
 * Sessions are minted with the same helpers the app uses, so the auth
 * path is genuinely exercised:
 *   - staff  : a next-auth JWT signed with NEXTAUTH_SECRET
 *   - client : the portal job-session cookie (HMAC over portalAccessId)
 *
 * Operates ONLY on the captured ZZTEST_ fixture ids. Nothing is deleted;
 * cleanup is a separate script that deletes by captured id.
 *
 * Run from the repo root with the dev server already up on :3000:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   node scripts/stage-contract-signing-test.mjs
 */
import { PrismaClient } from '@prisma/client'
import { createHmac } from 'node:crypto'
import { encode } from 'next-auth/jwt'
import { readFileSync } from 'node:fs'

// Staff and portal live on different hostnames in production, and hq
// 308s portal paths to tsx — a cross-origin redirect drops the Cookie
// header, so each call has to go to its own host directly.
const STAFF_BASE = process.env.TEST_STAFF_BASE || 'http://localhost:3000'
const PORTAL_BASE = process.env.TEST_PORTAL_BASE || STAFF_BASE
const ORDER_ID = '5ca0b2b6-db9f-4aea-aad3-a760a334c3f9'
const PORTAL_ACCESS_ID = 'defc2229-82ec-4ca6-9b79-ad1e95a4aac7'

// .env.local isn't auto-loaded in a bare node script.
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)
const SECRET = env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET
if (!SECRET) throw new Error('NEXTAUTH_SECRET not found in .env.local')

const prisma = new PrismaClient()
let failures = 0
const step = (n, msg) => console.log(`\n── ${n}. ${msg}`)
const chk = (ok, msg) => {
  console.log(`   ${ok ? 'ok  ' : 'FAIL'}  ${msg}`)
  if (!ok) failures++
}

// ── session minting (mirrors lib/portal/jobSession.ts) ──────────────
const b64url = (b) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
function jobSessionCookie(portalAccessId) {
  const payload = JSON.stringify({ portalAccessId, exp: Date.now() + 60 * 60 * 1000 })
  const head = b64url(payload)
  const mac = createHmac('sha256', SECRET).update(head).digest()
  return `${head}.${b64url(mac)}`
}

const staff = await prisma.user.findFirst({
  where: { role: { in: ['ADMIN', 'AGENT'] } },
  select: { id: true, email: true, name: true, role: true },
})
if (!staff) throw new Error('no ADMIN/AGENT user to authenticate as')

const staffJwt = await encode({
  token: { sub: staff.id, email: staff.email, name: staff.name, role: staff.role },
  secret: SECRET,
})

// ── 1. preconditions ────────────────────────────────────────────────
step(1, 'Preconditions')
const before = await prisma.signedAgreement.findFirst({
  where: { orderId: ORDER_ID, contractType: 'STAGE_CONTRACT' },
})
chk(!before, `no STAGE_CONTRACT exists yet${before ? ` (found ${before.status})` : ''}`)
const terms = await prisma.stageBookingTerms.findUnique({ where: { orderId: ORDER_ID } })
chk(!!terms, `stage booking terms present (${terms?.rentalDates?.length ?? 0} dates @ $${terms?.dailyRate})`)

// ── 2. staff generates the contract ─────────────────────────────────
step(2, `Staff generates contract (as ${staff.email})`)
const genRes = await fetch(`${STAFF_BASE}/api/orders/${ORDER_ID}/generate-stage-contract`, {
  method: 'POST',
  // NextAuth uses the __Secure- prefixed cookie over HTTPS and the bare
  // name over HTTP; send both so the same harness works either way.
  headers: {
    cookie: `next-auth.session-token=${staffJwt}; __Secure-next-auth.session-token=${staffJwt}`,
    'content-type': 'application/json',
  },
})
const genBody = await genRes.text()
chk(genRes.ok, `POST generate-stage-contract → ${genRes.status}`)
if (!genRes.ok) console.log(`        body: ${genBody.slice(0, 300)}`)

const generated = await prisma.signedAgreement.findFirst({
  where: { orderId: ORDER_ID, contractType: 'STAGE_CONTRACT' },
})
chk(!!generated, `SignedAgreement row created (status=${generated?.status})`)
chk(!!generated?.documentToSignUrl, 'unsigned PDF stored (documentToSignUrl set)')

// ── 3. client signs through the portal ──────────────────────────────
step(3, 'Client signs via portal session')
// A 1x1 transparent PNG — stands in for the signature-pad drawing.
const SIG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const signRes = await fetch(`${PORTAL_BASE}/api/portal/x/stage-agreement/sign`, {
  method: 'POST',
  headers: {
    cookie: `sr_portal_session=${jobSessionCookie(PORTAL_ACCESS_ID)}`,
    'content-type': 'application/json',
    // The route records both on the audit trail burned into the PDF.
    'x-forwarded-for': '203.0.113.42',
    'user-agent': 'ZZTEST-signing-harness/1.0',
  },
  body: JSON.stringify({
    signerName: 'ZZTEST Signer',
    signerTitle: 'Producer',
    signerEmail: 'zztest-signer-1785690376526@example.com',
    signatureImageData: SIG,
    acknowledgmentText:
      'I have read and agree to the SirReel Studio Services stage booking terms.',
  }),
})
const signBody = await signRes.text()
chk(signRes.ok, `POST stage-agreement/sign → ${signRes.status}`)
if (!signRes.ok) console.log(`        body: ${signBody.slice(0, 400)}`)

// ── 4. persisted result ─────────────────────────────────────────────
step(4, 'Signed state persisted')
const signed = await prisma.signedAgreement.findFirst({
  where: { orderId: ORDER_ID, contractType: 'STAGE_CONTRACT' },
})
chk(
  ['SIGNED_BASELINE', 'SIGNED_NEGOTIATED'].includes(signed?.status),
  `status is a SIGNED_* value (got ${signed?.status})`,
)
chk(!!signed?.signedAt, `signedAt stamped (${signed?.signedAt?.toISOString?.() ?? 'null'})`)
// The executed copy lands on signedDocumentUrl. There is no `pdfUrl`
// column on this model — asserting against it reads as undefined and
// passes the "different blob" check for the wrong reason.
chk(!!signed?.signedDocumentUrl, 'executed PDF stored (signedDocumentUrl set)')
chk(
  !!signed?.signedDocumentUrl &&
    !!signed?.documentToSignUrl &&
    signed.signedDocumentUrl !== signed.documentToSignUrl,
  'executed PDF is a DIFFERENT blob from the unsigned one',
)
chk(!!signed?.signatureImageData, 'signature image retained on the record')
chk(!!signed?.acknowledgmentText, 'acknowledgment text retained on the record')
chk(!!signed?.signerIpAddress, `signer IP captured (${signed?.signerIpAddress ?? 'none'})`)
console.log(`        signer: ${signed?.signerName ?? '—'} / ${signed?.signerEmail ?? '—'}  ip=${signed?.signerIpAddress ?? '—'}  ua=${signed?.signerUserAgent ?? '—'}`)

console.log(
  failures ? `\n${failures} CHECK(S) FAILED` : '\nall checks passed — contract generated and signed',
)
console.log(`agreementId=${signed?.id ?? 'none'}`)
await prisma.$disconnect()
process.exit(failures ? 1 : 0)
