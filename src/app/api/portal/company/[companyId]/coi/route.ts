/**
 * /api/portal/company/[companyId]/coi — the production company files a
 * certificate of insurance from its OWN account portal.
 *
 * Wes 2026-09-11: "for the client portal, I need a way for them to upload
 * COI. This should always be an option for them — 'Upload a COI for your
 * teams'." Until now an account certificate reached HQ only by a drop link a
 * rep minted, an attachment somebody harvested from Gmail, or a coordinator
 * uploading it on one job.
 *
 *   GET  → the account's certificates as the client sees them
 *   POST → multipart `file` (PDF / PNG / JPEG) → a PENDING CoiCheck
 *
 * ── What the row is ────────────────────────────────────────────────────
 * Company-scoped (`jobId` null), `source: 'CLIENT_UPLOAD'` — the value the
 * review desk, /admin/cois and the paperwork feed already read as "a client
 * sent this", with the signed-in person as the uploader so the desk's
 * "what's still missing" note goes back to them. The door is recorded in
 * AuditLog `coi.account_portal_upload`.
 *
 * It is NOT coverage on arrival. humanDecision stays PENDING; the carry-
 * forward (src/lib/coi/companyCoi.ts) spreads a certificate to the account's
 * shows only once someone at HQ approves it. Staff surfaces already show an
 * unreviewed account certificate as "awaiting HQ approval".
 *
 * The AI review runs HERE, on arrival, as on the drop link: it is what reads
 * the named insured and the expiry, and the uploader is standing right here
 * — the cheapest moment to say "this certificate insures somebody else".
 * Vehicle scope is unknown for an account certificate (no job), so the auto
 * checks stay required — the safe direction (lib/coi/vehicleScope.ts).
 *
 * Any live grant may upload, for the same reason any live grant may add a
 * card: the person holding the certificate is often an accounting seat a
 * producer invited, and every client-added seat is role OTHER.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyPortalSessionFromRequest } from '@/lib/portal/companyPortal'
import { listClientCois } from '@/lib/portal/companyPortalCois'
import { uploadCoiDocument } from '@/lib/coi/uploadCoiDocument'
import { runCoiAiReview } from '@/lib/coi/reviewCoi'
import { coiCheckWriteFields } from '@/lib/coi/checks'
import { evaluateInsuredMatch } from '@/lib/coi/insuredMatch'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients, dedupeEmails } from '@/lib/email/notificationChannels'
import { checkRateLimit } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'
// The AI review of a multi-page certificate can outrun the default budget;
// the other COI upload routes carry the same allowance.
export const maxDuration = 60

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
const MAX_BYTES = 25 * 1024 * 1024
/** Resend caps a send at 40 MB and base64 inflates by ~4/3 — past this the
 *  team email goes without the attachment (same cap as notifyHqDocument). */
const MAX_ATTACH_BYTES = 12 * 1024 * 1024
const RATE = { windowMs: 60 * 60_000, max: 20 }

/** By magic bytes — the extension and the browser's content-type are both
 *  whatever the client says they are. */
function sniffMime(buf: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (buf.length >= 8 && buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  return null
}

export async function GET(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, cois: await listClientCois(session.companyId) })
}

export async function POST(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rl = checkRateLimit(`company-portal-coi:${session.accessId}`, RATE)
  if (!rl.ok) {
    return NextResponse.json(
      { error: "That's a lot of uploads in a short time — try again in a while, or send it to your rep." },
      { status: 429 },
    )
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Attach your certificate of insurance (PDF, PNG or JPG).' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'That file is empty. Attach the certificate itself.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is too large (max 25 MB). Yours is ${(file.size / 1024 / 1024).toFixed(1)} MB.` },
      { status: 400 },
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const mimeType = sniffMime(buffer)
  if (!mimeType) {
    return NextResponse.json(
      { error: 'That doesn’t look like a PDF or an image. Upload the certificate as a PDF, PNG or JPG.' },
      { status: 400 },
    )
  }

  const company = await prisma.company.findUnique({
    where: { id: session.companyId },
    select: { id: true, name: true },
  })
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const originalFilename = (file.name || 'coi.pdf').slice(0, 250)

  // Store first; no row without its document.
  let stored: { fileUrl: string; blobKey: string }
  try {
    stored = await uploadCoiDocument({ filename: originalFilename, contentType: mimeType, data: buffer })
  } catch (err) {
    console.error('[company-portal-coi] blob write failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The upload failed while saving. Please try again.' }, { status: 502 })
  }

  // Never throws — a failed review still files the certificate for a human.
  const ai = await runCoiAiReview(buffer, mimeType)
  const aiFields = coiCheckWriteFields(ai, { vehiclesOnJob: null })

  const coi = await prisma.coiCheck.create({
    data: {
      fileKey: stored.blobKey,
      fileUrl: stored.fileUrl,
      originalFilename,
      fileSize: file.size,
      mimeType,
      jobId: null,
      companyId: company.id,
      source: 'CLIENT_UPLOAD',
      clientUploaderName: session.personName,
      clientUploaderEmail: session.personEmail,
      ...aiFields,
      // humanDecision stays PENDING — see the header.
    },
    select: { id: true, policyExpiryDate: true },
  })

  await prisma.auditLog
    .create({
      data: {
        action: 'coi.account_portal_upload',
        entityType: 'Company',
        entityId: company.id,
        newValues: {
          coiCheckId: coi.id,
          filename: originalFilename,
          byAccessId: session.accessId,
          byPersonId: session.personId,
          byName: session.personName,
          byEmail: session.personEmail,
          byRole: session.role,
        },
      },
    })
    .catch(() => null)

  // An account certificate is compared against the ACCOUNT — there is no
  // production name to fall back on, so a mismatch here means the policy
  // insures a different entity than the company it is filed under.
  const match = evaluateInsuredMatch(aiFields.namedInsured, [company.name])
  const insuredNotice =
    match.verdict === 'MISMATCH'
      ? match.clientMessage.startsWith('The certificate we received names SirReel')
        ? match.clientMessage
        : `This certificate is issued to “${match.namedInsured}”, not ${company.name}. If some of your shows rent under that company, tell your SirReel rep so the certificate is filed under the right one.`
      : null

  const expiry = coi.policyExpiryDate
    ? coi.policyExpiryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : 'not read'
  const who = `${session.personName} (${session.personEmail})`
  const attach = buffer.byteLength <= MAX_ATTACH_BYTES
  const reviewUrl = `${APP_URL}/admin/cois`
  const sent = await sendAgreementEmail({
    to: dedupeEmails([
      ...(await channelRecipients('coi-team').catch(() => [] as string[])),
      ...(await channelRecipients('hq-documents').catch(() => [] as string[])),
    ]),
    replyTo: session.personEmail,
    subject: `COI uploaded — ${company.name} (account portal)`,
    html: `<p>${esc(who)} uploaded a certificate of insurance for <b>${esc(company.name)}</b> from the account portal. It is filed against the ACCOUNT, so once approved it carries forward to every show it covers.</p>
<p><b>File:</b> ${esc(originalFilename)} (${(file.size / 1024 / 1024).toFixed(2)} MB)<br/>
<b>Named insured:</b> ${esc(aiFields.namedInsured || 'not read')}<br/>
<b>Policy expiry:</b> ${esc(expiry)}<br/>
${match.needsAttention ? `<b style="color:#b91c1c">Check the name:</b> ${esc(match.message)}<br/>` : ''}</p>
<p>${attach ? 'The certificate is attached. ' : 'The certificate was too large to attach. '}It is PENDING until someone approves it: <a href="${reviewUrl}">${reviewUrl}</a> (COI #${coi.id.slice(0, 8)}).</p>`,
    text: `${who} uploaded a COI for ${company.name} from the account portal (account-level, carries forward once approved).\nFile: ${originalFilename}\nNamed insured: ${aiFields.namedInsured || 'not read'}\nPolicy expiry: ${expiry}\n${match.needsAttention ? `CHECK THE NAME: ${match.message}\n` : ''}PENDING review: ${reviewUrl} (COI ${coi.id})`,
    attachments: attach ? [{ filename: originalFilename, content: buffer }] : undefined,
    label: 'company-portal-coi',
  }).catch((err) => ({ ok: false as const, reason: err instanceof Error ? err.message : String(err) }))
  if (!sent.ok) {
    // Filed fine; only the team email failed. The row is the record.
    console.error('[company-portal-coi] team email failed:', 'reason' in sent ? sent.reason : sent)
  }

  return NextResponse.json({ ok: true, coiId: coi.id, insuredNotice, cois: await listClientCois(company.id) })
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
