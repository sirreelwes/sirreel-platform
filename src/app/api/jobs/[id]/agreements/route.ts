import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 25 * 1024 * 1024
const ALLOWED_TYPES = new Set(['RENTAL_AGREEMENT', 'STAGE_CONTRACT'])

function safeSeg(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

async function readPdf(file: unknown): Promise<{ buffer: Buffer; name: string; size: number } | { error: string }> {
  if (!(file instanceof File)) return { error: 'Please attach a PDF file.' }
  if (file.size === 0) return { error: 'That file is empty.' }
  if (file.size > MAX_BYTES) return { error: `That file is too large (max 25 MB). It is ${(file.size / 1024 / 1024).toFixed(1)} MB.` }
  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') return { error: 'That doesn’t look like a PDF.' }
  return { buffer, name: (file.name || 'agreement.pdf').slice(0, 250), size: file.size }
}

async function storePrivatePdf(prefix: string, filename: string, buffer: Buffer): Promise<{ fileUrl: string; blobKey: string }> {
  const blobKey = `${prefix}/${randomUUID()}-${safeSeg(filename)}`
  const blob = await put(blobKey, buffer, { access: 'private' as 'public', contentType: 'application/pdf' })
  return { fileUrl: blob.url, blobKey }
}

/**
 * Job-level agreement coverage. A rental/stage agreement lives ON FILE
 * (CompanyAgreement, often annual) and a job is attached to it as an
 * addendum (JobAgreementAddendum) — manual, per job. This route serves the
 * job's current coverage and files/links it.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const job = await prisma.job.findUnique({ where: { id: params.id }, select: { companyId: true } })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const [companyAgreements, addenda] = await Promise.all([
    prisma.companyAgreement.findMany({
      where: { companyId: job.companyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, contractType: true, title: true, isAnnual: true,
        effectiveDate: true, expiryDate: true, originalFilename: true, createdAt: true,
      },
    }),
    prisma.jobAgreementAddendum.findMany({
      where: { jobId: params.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, note: true, addendumFileUrl: true, createdAt: true,
        companyAgreement: {
          select: {
            id: true, contractType: true, title: true, isAnnual: true,
            effectiveDate: true, expiryDate: true, originalFilename: true,
          },
        },
      },
    }),
  ])

  return NextResponse.json({ companyAgreements, addenda })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const job = await prisma.job.findUnique({ where: { id: params.id }, select: { id: true, companyId: true } })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const uploader = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Could not read the form.' }, { status: 400 })
  }

  const mode = (form.get('mode') || '').toString()
  const note = (form.get('note') || '').toString().trim().slice(0, 2000) || null

  // ── LINK: attach this job to an existing on-file agreement ────────────
  if (mode === 'link') {
    const companyAgreementId = (form.get('companyAgreementId') || '').toString()
    const master = companyAgreementId
      ? await prisma.companyAgreement.findFirst({
          where: { id: companyAgreementId, companyId: job.companyId, deletedAt: null },
          select: { id: true },
        })
      : null
    if (!master) return NextResponse.json({ error: 'That agreement was not found for this company.' }, { status: 404 })

    const existing = await prisma.jobAgreementAddendum.findFirst({
      where: { jobId: job.id, companyAgreementId: master.id, deletedAt: null },
      select: { id: true },
    })
    if (existing) return NextResponse.json({ error: 'This job is already linked to that agreement.' }, { status: 409 })

    // Optional signed addendum page.
    let addendum: { fileKey: string; fileUrl: string; filename: string; size: number } | null = null
    const addFile = form.get('addendumFile')
    if (addFile instanceof File && addFile.size > 0) {
      const parsed = await readPdf(addFile)
      if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
      const stored = await storePrivatePdf(`job-addenda/${job.id}`, parsed.name, parsed.buffer)
      addendum = { fileKey: stored.blobKey, fileUrl: stored.fileUrl, filename: parsed.name, size: parsed.size }
    }

    const created = await prisma.jobAgreementAddendum.create({
      data: {
        jobId: job.id,
        companyAgreementId: master.id,
        note,
        addedById: uploader?.id ?? null,
        ...(addendum && {
          addendumFileKey: addendum.fileKey,
          addendumFileUrl: addendum.fileUrl,
          addendumFilename: addendum.filename,
          addendumFileSize: addendum.size,
        }),
      },
      select: { id: true },
    })
    return NextResponse.json({ ok: true, addendumId: created.id })
  }

  // ── FILE: create a new on-file agreement AND link this job ────────────
  if (mode === 'file') {
    const contractType = (form.get('contractType') || 'RENTAL_AGREEMENT').toString()
    if (!ALLOWED_TYPES.has(contractType)) return NextResponse.json({ error: 'Invalid agreement type.' }, { status: 400 })

    const parsed = await readPdf(form.get('file'))
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const isAnnual = form.get('isAnnual') === 'true'
    const title = (form.get('title') || '').toString().trim().slice(0, 200) || null
    const signerName = (form.get('signerName') || '').toString().trim().slice(0, 200) || null
    const parseDate = (k: string): Date | null => {
      const raw = (form.get(k) || '').toString().trim()
      if (!raw) return null
      const d = new Date(raw)
      return Number.isNaN(d.getTime()) ? null : d
    }
    const effectiveDate = parseDate('effectiveDate')
    const expiryDate = parseDate('expiryDate')
    const signedAt = parseDate('signedDate')

    const stored = await storePrivatePdf(`company-agreements/${job.companyId}`, parsed.name, parsed.buffer)

    const result = await prisma.$transaction(async (tx) => {
      const master = await tx.companyAgreement.create({
        data: {
          companyId: job.companyId,
          contractType: contractType as 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT',
          title,
          fileKey: stored.blobKey,
          fileUrl: stored.fileUrl,
          originalFilename: parsed.name,
          fileSize: parsed.size,
          mimeType: 'application/pdf',
          isAnnual,
          effectiveDate,
          expiryDate,
          signerName,
          signedAt,
          note,
          source: 'INTERNAL',
          uploadedById: uploader?.id ?? null,
        },
        select: { id: true },
      })
      const addendum = await tx.jobAgreementAddendum.create({
        data: { jobId: job.id, companyAgreementId: master.id, note, addedById: uploader?.id ?? null },
        select: { id: true },
      })
      return { masterId: master.id, addendumId: addendum.id }
    })

    return NextResponse.json({ ok: true, ...result })
  }

  return NextResponse.json({ error: 'Unknown mode.' }, { status: 400 })
}

// DELETE — unlink this job from an agreement (soft delete the addendum).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const addendumId = searchParams.get('addendumId')
  if (!addendumId) return NextResponse.json({ error: 'addendumId required' }, { status: 400 })

  const addendum = await prisma.jobAgreementAddendum.findFirst({
    where: { id: addendumId, jobId: params.id, deletedAt: null },
    select: { id: true },
  })
  if (!addendum) return NextResponse.json({ error: 'Link not found' }, { status: 404 })

  await prisma.jobAgreementAddendum.update({ where: { id: addendum.id }, data: { deletedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
