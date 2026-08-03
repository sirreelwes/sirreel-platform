/**
 * Reset the ZZTEST stage contract to unsigned, then regenerate it.
 *
 * Deletes ONE SignedAgreement row by its CAPTURED id — the row created by
 * scripts/stage-contract-signing-test.mjs on 2026-08-02. Never by pattern,
 * never by order scope (per CLAUDE.md's live-DB rules: this database is
 * production).
 *
 * The two blobs from the signed run stay in Vercel Blob. They are private
 * and orphaned, which is harmless — and it means the executed copy from
 * the passing test still exists if it is ever needed.
 *
 * Run from the repo root:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   node scripts/stage-contract-reset.mjs
 */
import { PrismaClient } from '@prisma/client'
import { encode } from 'next-auth/jwt'
import { readFileSync } from 'node:fs'

const ORDER_ID = '5ca0b2b6-db9f-4aea-aad3-a760a334c3f9'
// The stage contract on the ZZTEST order. Pass an id as argv[2] to be
// explicit; otherwise the script looks the current one up and asserts it
// belongs to the fixture order before deleting anything.
const SIGNED_AGREEMENT_ID = process.argv[2] || null
const STAFF_BASE = process.env.TEST_STAFF_BASE || 'https://hq.sirreel.com'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)
const SECRET = env.NEXTAUTH_SECRET
const prisma = new PrismaClient()

// Confirm we are deleting the row we think we are, before deleting it.
const target = SIGNED_AGREEMENT_ID
  ? await prisma.signedAgreement.findUnique({
      where: { id: SIGNED_AGREEMENT_ID },
      select: { id: true, orderId: true, contractType: true, status: true, signerName: true },
    })
  : await prisma.signedAgreement.findFirst({
      where: { orderId: ORDER_ID, contractType: 'STAGE_CONTRACT' },
      select: { id: true, orderId: true, contractType: true, status: true, signerName: true },
    })
if (!target) {
  console.log('No row with that id — already reset. Continuing to regenerate.')
} else if (target.orderId !== ORDER_ID || target.contractType !== 'STAGE_CONTRACT') {
  throw new Error(`Refusing to delete: id ${target.id} is not the ZZTEST stage contract`)
} else {
  console.log(`deleting  ${target.contractType} ${target.status} (signer: ${target.signerName})`)
  const r = await prisma.signedAgreement.deleteMany({ where: { id: target.id } })
  console.log(`deleted   ${r.count} row`)
}

// Regenerate through the real endpoint, as staff.
const staff = await prisma.user.findFirst({
  where: { role: { in: ['ADMIN', 'AGENT'] } },
  select: { id: true, email: true, name: true, role: true },
})
const jwt = await encode({
  token: { sub: staff.id, email: staff.email, name: staff.name, role: staff.role },
  secret: SECRET,
})
const res = await fetch(`${STAFF_BASE}/api/orders/${ORDER_ID}/generate-stage-contract`, {
  method: 'POST',
  headers: {
    cookie: `next-auth.session-token=${jwt}; __Secure-next-auth.session-token=${jwt}`,
    'content-type': 'application/json',
  },
})
console.log(`regenerate → ${res.status}${res.ok ? '' : ' ' + (await res.text()).slice(0, 200)}`)

const fresh = await prisma.signedAgreement.findFirst({
  where: { orderId: ORDER_ID, contractType: 'STAGE_CONTRACT' },
  select: {
    id: true, status: true, signedAt: true, signerName: true,
    documentToSignUrl: true, signedDocumentUrl: true,
  },
})
console.log('\nfresh contract:')
console.log('  id                ', fresh?.id)
console.log('  status            ', fresh?.status, fresh?.status === 'PORTAL_GENERATED' ? '(ready to sign)' : '(UNEXPECTED)')
console.log('  signedAt          ', fresh?.signedAt ?? 'null (unsigned)')
console.log('  signerName        ', fresh?.signerName ?? 'null')
console.log('  documentToSignUrl ', fresh?.documentToSignUrl ? 'set' : 'MISSING')
console.log('  signedDocumentUrl ', fresh?.signedDocumentUrl ?? 'null (as expected)')

const order = await prisma.order.findUnique({
  where: { id: ORDER_ID },
  select: { portalSlug: true },
})
const access = await prisma.portalAccess.findFirst({
  where: { orderId: ORDER_ID, revokedAt: null },
  select: { magicLinkToken: true, magicLinkExpiresAt: true },
})
console.log('\nportal link:')
console.log(`  https://tsx.sirreel.com/portal/job/${order.portalSlug}?token=${access.magicLinkToken}`)
console.log(`  (valid to ${access.magicLinkExpiresAt.toISOString().slice(0, 10)})`)

await prisma.$disconnect()
