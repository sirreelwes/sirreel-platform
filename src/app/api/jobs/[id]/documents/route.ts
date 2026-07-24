import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import type { JobDocumentKind } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Transitional RentalWorks document store, per Job.
 *
 * RW's API exposes NO print/PDF endpoint (every print/report path 404s;
 * its documents endpoint throws a SQL error), and `quote/browse` is broken
 * outright — so quotes can't even be listed. Until quoting/invoicing is
 * fully native, staff export the PDF from RW and attach it here so HQ is
 * the single place to FIND the document while RW stays the record.
 *
 * GET  /api/jobs/[id]/documents  → list
 * POST /api/jobs/[id]/documents  → multipart upload
 */

const MAX_BYTES = 25 * 1024 * 1024
const KINDS = new Set<JobDocumentKind>(['QUOTE', 'INVOICE', 'OTHER'])

function safeSeg(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const documents = await prisma.jobDocument.findMany({
    where: { jobId: params.id, deletedAt: null },
    orderBy: [{ documentDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      kind: true,
      source: true,
      refNumber: true,
      amount: true,
      documentDate: true,
      originalFilename: true,
      fileSize: true,
      note: true,
      createdAt: true,
      uploadedBy: { select: { id: true, name: true } },
    },
  })
  return NextResponse.json({
    documents: documents.map((d) => ({ ...d, amount: d.amount == null ? null : Number(d.amount) })),
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const job = await prisma.job.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Expected a file upload.' }, { status: 400 })

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Please attach a PDF file.' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is too large (max 25 MB). It is ${(file.size / 1024 / 1024).toFixed(1)} MB.` },
      { status: 400 },
    )
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return NextResponse.json({ error: 'That doesn’t look like a PDF.' }, { status: 400 })
  }

  const rawKind = String(form.get('kind') || 'OTHER').toUpperCase() as JobDocumentKind
  const kind: JobDocumentKind = KINDS.has(rawKind) ? rawKind : 'OTHER'
  const refNumber = String(form.get('refNumber') || '').trim().slice(0, 60) || null
  const note = String(form.get('note') || '').trim().slice(0, 2000) || null
  const rawAmount = String(form.get('amount') || '').trim()
  const amount = rawAmount && Number.isFinite(Number(rawAmount)) ? Number(rawAmount) : null
  const rawDate = String(form.get('documentDate') || '').trim()
  const documentDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00.000Z`) : null
  const source = String(form.get('source') || 'RENTALWORKS').trim().slice(0, 40) || 'RENTALWORKS'

  const originalFilename = (file.name || `${kind.toLowerCase()}.pdf`).slice(0, 250)
  const fileKey = `job-documents/${params.id}/${randomUUID()}-${safeSeg(originalFilename)}`
  const blob = await put(fileKey, buffer, {
    access: 'private' as 'public',
    contentType: 'application/pdf',
  })

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })

  const doc = await prisma.jobDocument.create({
    data: {
      jobId: params.id,
      kind,
      source,
      refNumber,
      amount,
      documentDate,
      note,
      fileKey,
      fileUrl: blob.url,
      originalFilename,
      fileSize: file.size,
      mimeType: 'application/pdf',
      uploadedById: user?.id ?? null,
    },
    select: { id: true, kind: true, refNumber: true, originalFilename: true },
  })

  return NextResponse.json({ ok: true, document: doc }, { status: 201 })
}
