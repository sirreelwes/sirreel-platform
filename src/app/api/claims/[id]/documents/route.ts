/**
 * POST /api/claims/[id]/documents
 *
 * Multi-file upload endpoint. Accepts multipart/form-data with one
 * or more "files" entries. For each:
 *   1. Upload to Vercel Blob via uploadClaimDocument()
 *   2. Run classifyClaimDocument() (Sonnet — falls back to OTHER on
 *      any failure; never blocks the upload)
 *   3. Create a ClaimDocument row with typeSource=AI_SUGGESTED + the
 *      AI confidence score
 *
 * A single ClaimTimeline row is appended for the whole batch (one
 * action per drop, not per file) so the timeline stays readable.
 *
 * Auth: getServerSession-guarded; uploadedBy stamped on each row.
 *
 * Response shape — array of created documents, in upload order, so
 * the UI can render the AI suggestions as editable chips inline:
 *   { ok: true, documents: [{
 *       id, type, typeSource, typeConfidence, title, fileUrl, notes
 *     }, ...] }
 *
 * Per-file failures (blob error, no buffer) return as
 *   { filename, error: string } in a parallel `errors` array — the
 * UI surfaces these inline rather than failing the whole batch.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { ClaimDocType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { uploadClaimDocument } from '@/lib/claims/uploadClaimDocument'
import { classifyClaimDocument } from '@/lib/claims/classifyClaimDocument'

export const dynamic = 'force-dynamic'
// Sonnet PDF classification can run 4-6s per file; the route is also
// hitting Blob for each upload. Bump the per-route timeout so the
// fire-and-respond cycle has headroom on multi-file drops.
export const maxDuration = 60

const MAX_FILES_PER_BATCH = 12
const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB — same cap as the email-attachment path

type Params = { params: Promise<{ id: string }> }

interface UploadedDoc {
  id: string
  type: ClaimDocType
  typeSource: string | null
  typeConfidence: number | null
  title: string
  fileUrl: string
  notes: string | null
  classificationReasoning: string | null
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true },
  })
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id: claimId } = await params
  const claim = await prisma.insuranceClaim.findUnique({
    where: { id: claimId },
    select: { id: true, claimNumber: true },
  })
  if (!claim) return NextResponse.json({ error: 'claim not found' }, { status: 404 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 })
  }
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return NextResponse.json({ error: 'no files in body' }, { status: 400 })
  }
  if (files.length > MAX_FILES_PER_BATCH) {
    return NextResponse.json(
      { error: `too many files in one batch — max ${MAX_FILES_PER_BATCH}` },
      { status: 400 },
    )
  }

  const uploaded: UploadedDoc[] = []
  const errors: { filename: string; error: string }[] = []

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      errors.push({ filename: file.name, error: `file too large (${file.size} bytes; max ${MAX_FILE_BYTES})` })
      continue
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer())

      // Upload BEFORE classifying — a slow Sonnet call shouldn't tie up
      // the blob upload, and we still get the row created even if the
      // classifier degrades to OTHER.
      const { fileUrl } = await uploadClaimDocument({
        claimNumber: claim.claimNumber,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        data: buf,
        kindSuffix: 'upload',
      })

      // Classify. Bounded by the helper's try/catch — won't throw.
      const cls = await classifyClaimDocument({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        fileBuffer: buf,
      })

      const doc = await prisma.claimDocument.create({
        data: {
          claimId,
          type: cls.docType,
          typeSource: 'AI_SUGGESTED',
          typeConfidence: cls.confidence,
          title: file.name.slice(0, 200),
          fileUrl,
          uploadedBy: me.id,
          notes: cls.reasoning ? `AI: ${cls.reasoning}` : null,
        },
        select: {
          id: true, type: true, typeSource: true, typeConfidence: true,
          title: true, fileUrl: true, notes: true,
        },
      })
      uploaded.push({ ...doc, classificationReasoning: cls.reasoning })
    } catch (err) {
      console.error('[POST /claims/documents] file failed:', file.name, err instanceof Error ? err.message : err)
      errors.push({ filename: file.name, error: 'upload failed' })
    }
  }

  // One timeline entry per batch — clearer than one per file when a
  // drop has 8 photos. Names the uploader so the audit trail is intact.
  if (uploaded.length > 0) {
    await prisma.claimTimeline.create({
      data: {
        claimId,
        action: 'DOCUMENT_ADDED',
        description: `${me.name ?? 'Rep'} uploaded ${uploaded.length} document${uploaded.length === 1 ? '' : 's'}${errors.length > 0 ? ` (${errors.length} failed)` : ''}.`,
        performedBy: me.id,
        isAi: false,
      },
    }).catch((err) => console.warn('[POST /claims/documents] timeline write failed:', err))
  }

  return NextResponse.json(
    { ok: true, documents: uploaded, errors },
    { status: uploaded.length > 0 ? 201 : 400 },
  )
}
