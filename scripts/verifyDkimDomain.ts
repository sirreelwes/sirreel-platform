/**
 * Empirical DKIM signing-domain verification.
 *
 * Sends a tiny test email through the live Resend send path (the same
 * sendAgreementEmail helper every client-facing send uses), then DWD-
 * impersonates wes@sirreel.com via Gmail to fetch the delivered
 * message's headers and report the actual `Authentication-Results`
 * dkim= line. The header.d= value there is the truth on signing
 * domain — code-side From: addresses don't establish it; Resend's
 * domain config does, and that's invisible from this repo.
 *
 * Why this matters: if dkim header.d= sirreel.com (root), we're fine
 * and the long-standing iCloud filter risk is resolved. If
 * d=send.sirreel.com (subdomain), iCloud and a handful of corporate
 * filters quietly drop client-facing mail.
 *
 * Run:
 *   export RESEND_API_KEY=$(grep '^RESEND_API_KEY=' .env.local | head -1 | cut -d'=' -f2-)
 *   npx tsx scripts/verifyDkimDomain.ts
 */

import './_loadProdEnv'
import { Resend } from 'resend'
import { google } from 'googleapis'

const TARGET = 'wes@sirreel.com'
const SUBJECT_TAG = `DKIM-VERIFY-${Date.now()}`

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function sendProbe(): Promise<string> {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY missing')
  const resend = new Resend(process.env.RESEND_API_KEY)
  const result = await resend.emails.send({
    from: 'SirReel HQ <notifications@sirreel.com>',
    to: [TARGET],
    subject: SUBJECT_TAG,
    html: `<p>DKIM verification probe. Subject tag: ${SUBJECT_TAG}</p>`,
    text: `DKIM verification probe. Subject tag: ${SUBJECT_TAG}`,
  })
  if ((result as { error?: unknown }).error) {
    throw new Error('resend.send error: ' + JSON.stringify((result as { error: unknown }).error))
  }
  const id = (result as { data?: { id?: string } }).data?.id ?? '?'
  console.log(`Sent via Resend. message id=${id}  subject="${SUBJECT_TAG}"`)
  return SUBJECT_TAG
}

interface HeaderHit {
  name: string
  value: string
}

async function fetchHeaders(subject: string): Promise<HeaderHit[] | null> {
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!rawKey) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY missing — _loadProdEnv must load .env.prod.local')
  const creds = JSON.parse(rawKey) as { client_email: string; private_key: string }
  const auth = new google.auth.JWT(
    creds.client_email,
    undefined,
    creds.private_key,
    ['https://www.googleapis.com/auth/gmail.readonly'],
    TARGET,
  )
  const gmail = google.gmail({ version: 'v1', auth })

  // Newest first. Gmail's index can be a few seconds behind Resend's
  // accept, so we poll briefly.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: `subject:"${subject}" newer_than:1d`,
      maxResults: 1,
    })
    const id = list.data.messages?.[0]?.id
    if (id) {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['Authentication-Results', 'DKIM-Signature', 'From', 'Return-Path', 'Received-SPF'],
      })
      return (msg.data.payload?.headers ?? []).map((h) => ({
        name: h.name ?? '',
        value: h.value ?? '',
      }))
    }
    console.log(`  not yet indexed (attempt ${attempt + 1}/6) — sleeping 5s`)
    await sleep(5_000)
  }
  return null
}

function parseDkim(headers: HeaderHit[]): {
  authResults: string | null
  dkimSignature: string | null
  dkimDomain: string | null
} {
  const authResults = headers.find((h) => h.name.toLowerCase() === 'authentication-results')?.value ?? null
  const dkimSignature = headers.find((h) => h.name.toLowerCase() === 'dkim-signature')?.value ?? null
  // Prefer DKIM-Signature header's d= tag — that's the unambiguous
  // signing-domain claim. Fall back to Authentication-Results.
  let dkimDomain: string | null = null
  if (dkimSignature) {
    const m = dkimSignature.match(/(?:^|[\s;])d=([^;\s]+)/)
    if (m) dkimDomain = m[1]
  }
  if (!dkimDomain && authResults) {
    const m = authResults.match(/dkim=pass[^;]*header\.(?:i=@?|d=)([^\s;,]+)/i)
    if (m) dkimDomain = m[1].replace(/^@/, '')
  }
  return { authResults, dkimSignature, dkimDomain }
}

async function main() {
  const subject = await sendProbe()
  console.log('Waiting 10s for Gmail to index…')
  await sleep(10_000)
  const headers = await fetchHeaders(subject)
  if (!headers) {
    console.log('Could not locate the probe message in wes@ within 40s.')
    process.exit(2)
  }
  const { authResults, dkimSignature, dkimDomain } = parseDkim(headers)
  console.log('\n── Headers ───────────────────────────────────────────────')
  for (const h of headers) console.log(`  ${h.name}: ${h.value}`)
  console.log('\n── Verdict ───────────────────────────────────────────────')
  console.log(`  DKIM-Signature present: ${dkimSignature ? 'yes' : 'no'}`)
  console.log(`  Authentication-Results present: ${authResults ? 'yes' : 'no'}`)
  console.log(`  DKIM signing domain (d=):  ${dkimDomain ?? '(unable to parse)'}`)
  if (dkimDomain === 'sirreel.com') {
    console.log('  → root-domain signed. No iCloud filtering risk. PASS.')
  } else if (dkimDomain === 'send.sirreel.com') {
    console.log('  → SUBDOMAIN-signed. iCloud filtering risk remains. FIX OWED.')
  } else if (dkimDomain) {
    console.log(`  → unexpected signing domain "${dkimDomain}"; investigate.`)
  }
}

main().catch((err) => {
  console.error('Probe failed:', err)
  process.exit(1)
})
