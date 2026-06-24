import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyCoiToken } from '@/lib/coi/coiUploadToken'
import { uploadCoiDocument } from '@/lib/coi/uploadCoiDocument'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB
// Where the COI lands so the team's current manual workflow is preserved.
const COI_TEAM_INBOX = 'rentals@sirreel.com'

/**
 * POST /api/coi/[token] — client-facing COI drop (no login; the signed
 * token IS the auth). Validates a real PDF, then does BOTH:
 *   (a) emails it as an attachment to the team COI inbox (current workflow), and
 *   (b) stores it private-Blob + a CoiCheck row attached to the token's
 *       job / company / inquiry — or UNATTACHED if the token carries none.
 * A storage success with an email failure (e.g. unverified send domain) is
 * still a success: the file is captured in HQ and emailResult is surfaced.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const payload = verifyCoiToken(token)
  if (!payload) {
    return NextResponse.json({ error: 'This upload link is invalid or has expired.' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Could not read the upload. Please try again.' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Please attach a PDF file.' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'That file is empty. Please attach your COI PDF.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is too large (max 25 MB). Yours is ${(file.size / 1024 / 1024).toFixed(1)} MB.` },
      { status: 400 },
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  // Validate it's actually a PDF — by magic bytes, not just the extension
  // or the browser-supplied content-type (both are spoofable).
  const isPdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-'
  if (!isPdf) {
    return NextResponse.json(
      { error: 'That doesn’t look like a PDF. Please upload your Certificate of Insurance as a PDF.' },
      { status: 400 },
    )
  }

  const uploaderName = (form.get('uploaderName') || '').toString().trim().slice(0, 200) || null
  const uploaderEmail = (form.get('uploaderEmail') || '').toString().trim().slice(0, 200) || null
  const originalFilename = (file.name || 'coi.pdf').slice(0, 250)

  // Store privately, then create the CoiCheck. If the blob write fails we
  // bail before creating a dangling row.
  let stored: { fileUrl: string; blobKey: string }
  try {
    stored = await uploadCoiDocument({ filename: originalFilename, contentType: 'application/pdf', data: buffer })
  } catch (err) {
    console.error('[coi upload] blob write failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Upload failed while saving. Please try again.' }, { status: 502 })
  }

  // Only stamp FKs the token actually carries AND that still exist, so a
  // stale link never errors — it just lands UNATTACHED for the team.
  const jobId = payload.jobId && (await prisma.job.findUnique({ where: { id: payload.jobId }, select: { id: true } })) ? payload.jobId : null
  const companyId = payload.companyId && (await prisma.company.findUnique({ where: { id: payload.companyId }, select: { id: true } })) ? payload.companyId : null
  const inquiryId = payload.inquiryId && (await prisma.inquiry.findUnique({ where: { id: payload.inquiryId }, select: { id: true } })) ? payload.inquiryId : null

  const coi = await prisma.coiCheck.create({
    data: {
      fileKey: stored.blobKey,
      fileUrl: stored.fileUrl,
      originalFilename,
      fileSize: file.size,
      mimeType: 'application/pdf',
      jobId,
      companyId,
      inquiryId,
      source: 'CLIENT_UPLOAD',
      clientUploaderName: uploaderName,
      clientUploaderEmail: uploaderEmail,
      aiResponse: undefined, // nullable now — team runs AI review later
    },
    select: { id: true },
  })

  // Resolve friendly context for the email subject/body.
  const [company, job] = await Promise.all([
    companyId ? prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }) : Promise.resolve(null),
    jobId ? prisma.job.findUnique({ where: { id: jobId }, select: { name: true, jobCode: true } }) : Promise.resolve(null),
  ])
  const ctx =
    job ? `${company?.name ? company.name + ' — ' : ''}${job.name} (${job.jobCode})`
      : company ? company.name
      : inquiryId ? 'an inquiry (no job yet)'
      : 'an unattached client (no job/company yet)'
  const subject = `COI uploaded — ${ctx}`
  const who = uploaderName || uploaderEmail || 'A client'

  const emailResult = await sendAgreementEmail({
    to: [COI_TEAM_INBOX],
    subject,
    html: `<p>${escapeHtml(who)} uploaded a Certificate of Insurance via the client COI link.</p>
<p><b>Context:</b> ${escapeHtml(ctx)}<br/>
<b>File:</b> ${escapeHtml(originalFilename)} (${(file.size / 1024 / 1024).toFixed(2)} MB)<br/>
${uploaderEmail ? `<b>From:</b> ${escapeHtml(uploaderEmail)}<br/>` : ''}</p>
<p>The PDF is attached, and a copy is filed in HQ (COI #${coi.id.slice(0, 8)}).</p>`,
    text: `${who} uploaded a COI via the client link.\nContext: ${ctx}\nFile: ${originalFilename} (${(file.size / 1024 / 1024).toFixed(2)} MB)\nFiled in HQ as COI ${coi.id}.`,
    attachments: [{ filename: originalFilename, content: buffer }],
    label: 'coi-upload',
  })
  if (!emailResult.ok) {
    // Stored fine; the team email failed (e.g. unverified send domain).
    // Don't fail the client — log it; the file is safely in HQ.
    console.error('[coi upload] team email failed:', emailResult.reason)
  }

  return NextResponse.json({
    ok: true,
    coiId: coi.id,
    attached: jobId ? 'job' : companyId ? 'company' : inquiryId ? 'inquiry' : 'unattached',
    emailed: emailResult.ok,
    emailReason: emailResult.ok ? undefined : emailResult.reason,
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
