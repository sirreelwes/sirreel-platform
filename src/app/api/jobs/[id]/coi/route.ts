import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { uploadCoiDocument } from '@/lib/coi/uploadCoiDocument'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB — matches the client COI drop.

/**
 * POST /api/jobs/[id]/coi — internal, authed COI attach for a job.
 *
 * The backfill/offline path: a client sent a signed Certificate of
 * Insurance the old way (email, broker, RentalWorks) and an agent files
 * it against the HQ job so HQ becomes the source of truth without forcing
 * a re-upload through the portal link. Mirrors the client drop
 * (src/app/api/coi/[token]) — private-Blob storage + a CoiCheck row — but
 * source=INTERNAL, attributed to the signed-in user, and the agent may
 * mark coverage verified inline (which stamps an APPROVED human decision)
 * so the job's COI status flips Missing → Verified immediately.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    select: { id: true, companyId: true },
  })
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  const uploader = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })

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
    return NextResponse.json({ error: 'That file is empty. Please attach the COI PDF.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is too large (max 25 MB). It is ${(file.size / 1024 / 1024).toFixed(1)} MB.` },
      { status: 400 },
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  // Validate a real PDF by magic bytes — not the extension or the
  // browser-supplied content-type (both spoofable). Same guard as the
  // client drop.
  const isPdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-'
  if (!isPdf) {
    return NextResponse.json(
      { error: 'That doesn’t look like a PDF. Please attach the Certificate of Insurance as a PDF.' },
      { status: 400 },
    )
  }

  const originalFilename = (file.name || 'coi.pdf').slice(0, 250)
  const coverageVerified = form.get('coverageVerified') === 'true'
  const additionalInsured = form.get('additionalInsured') === 'true'
  const note = (form.get('note') || '').toString().trim().slice(0, 2000) || null
  const expiryRaw = (form.get('policyExpiryDate') || '').toString().trim()
  const policyExpiryDate = expiryRaw ? new Date(expiryRaw) : null
  if (policyExpiryDate && Number.isNaN(policyExpiryDate.getTime())) {
    return NextResponse.json({ error: 'Policy expiry date is not a valid date.' }, { status: 400 })
  }

  let stored: { fileUrl: string; blobKey: string }
  try {
    stored = await uploadCoiDocument({ filename: originalFilename, contentType: 'application/pdf', data: buffer })
  } catch (err) {
    console.error('[job coi upload] blob write failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Upload failed while saving. Please try again.' }, { status: 502 })
  }

  const coi = await prisma.coiCheck.create({
    data: {
      fileKey: stored.blobKey,
      fileUrl: stored.fileUrl,
      originalFilename,
      fileSize: file.size,
      mimeType: 'application/pdf',
      jobId: job.id,
      companyId: job.companyId ?? null,
      source: 'INTERNAL',
      uploadedById: uploader?.id ?? null,
      policyExpiryDate,
      additionalInsured,
      coverageVerified,
      // Marking coverage verified at upload records the agent's human
      // sign-off, so the job reads Verified without a second review pass.
      ...(coverageVerified && {
        humanDecision: 'APPROVED' as const,
        humanDecisionById: uploader?.id ?? null,
        humanDecisionAt: new Date(),
        humanDecisionNote: note ?? 'Verified on upload (offline COI).',
      }),
      ...(!coverageVerified && note ? { humanDecisionNote: note } : {}),
    },
    select: { id: true },
  })

  return NextResponse.json({ ok: true, coiId: coi.id })
}
