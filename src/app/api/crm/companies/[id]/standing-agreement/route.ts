/**
 * Standing-agreement (negotiated terms) endpoint — writes the
 * Company.negotiatedTerms* columns.
 *
 * Path A from the discovery report: the negotiated PDF IS the
 * authoritative document. No clause reassembly. The columns
 * already exist; this just plumbs writes through.
 *
 * Multipart POST so the agent uploads the negotiated PDF in the
 * same request that fills the metadata fields. File is optional —
 * agents can edit dates/summary without re-uploading. DELETE
 * clears the standing-agreement state (does NOT remove the blob,
 * for audit).
 *
 * Auth: getServerSession on both methods.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { put } from '@vercel/blob'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_FILE_BYTES = 20 * 1024 * 1024
const ACCEPTED_MIME = new Set(['application/pdf'])

type Params = { params: Promise<{ id: string }> }

function parseDate(v: FormDataEntryValue | null): Date | null {
  if (!v) return null
  const s = String(v).trim()
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const company = await prisma.company.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })

  const file = form.get('file') as File | null
  const summary = (form.get('summary') as string | null) || null
  const approvedBy = (form.get('approvedBy') as string | null) || null
  const negotiatedAt = parseDate(form.get('negotiatedAt'))
  const approvedAt = parseDate(form.get('approvedAt'))
  const activeAsOf = parseDate(form.get('activeAsOf'))
  const reviewDueDate = parseDate(form.get('reviewDueDate'))

  const data: Record<string, unknown> = {
    negotiatedTermsSummary: summary,
    negotiatedTermsApprovedBy: approvedBy,
    negotiatedTermsNegotiatedAt: negotiatedAt,
    negotiatedTermsApprovedAt: approvedAt,
    negotiatedTermsActiveAsOf: activeAsOf,
    negotiatedTermsReviewDueDate: reviewDueDate,
  }

  if (file && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File exceeds 20 MB limit' }, { status: 413 })
    }
    if (!ACCEPTED_MIME.has(file.type)) {
      return NextResponse.json({ error: 'Only .pdf files are accepted' }, { status: 415 })
    }
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '-')
    const blobKey = `standing-agreements/${id}/${Date.now()}-${randomUUID()}-${safeName}`
    try {
      const uploaded = await put(blobKey, buffer, { access: 'public', contentType: file.type })
      data.negotiatedTermsUrl = uploaded.url
    } catch (err) {
      console.error('[standing-agreement] blob upload failed:', err)
      return NextResponse.json({ error: 'Failed to save uploaded file' }, { status: 500 })
    }
  }

  const updated = await prisma.company.update({ where: { id }, data })
  return NextResponse.json({
    company: {
      id: updated.id,
      negotiatedTermsUrl: updated.negotiatedTermsUrl,
      negotiatedTermsSummary: updated.negotiatedTermsSummary,
      negotiatedTermsNegotiatedAt: updated.negotiatedTermsNegotiatedAt,
      negotiatedTermsApprovedBy: updated.negotiatedTermsApprovedBy,
      negotiatedTermsApprovedAt: updated.negotiatedTermsApprovedAt,
      negotiatedTermsActiveAsOf: updated.negotiatedTermsActiveAsOf,
      negotiatedTermsReviewDueDate: updated.negotiatedTermsReviewDueDate,
    },
  })
}

// DELETE clears the standing-agreement state. The blob itself is
// intentionally NOT deleted — the URL stays in any past audit logs
// that captured it, and re-recording a fresh agreement creates a
// new blob anyway. Clear ≠ retract.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  await prisma.company.update({
    where: { id },
    data: {
      negotiatedTermsUrl: null,
      negotiatedTermsSummary: null,
      negotiatedTermsNegotiatedAt: null,
      negotiatedTermsApprovedBy: null,
      negotiatedTermsApprovedAt: null,
      negotiatedTermsActiveAsOf: null,
      negotiatedTermsReviewDueDate: null,
    },
  })
  return NextResponse.json({ ok: true })
}
