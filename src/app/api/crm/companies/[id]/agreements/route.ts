/**
 * GET /api/crm/companies/[id]/agreements — the masters filed for a company,
 * with which one (if any) is currently auto-covering its jobs.
 *
 * The job-scoped sibling at /api/jobs/[id]/agreements answers "what covers
 * THIS job". This one answers "how is this account set up", which is the
 * question the CRM page asks and the one an annual account is configured
 * from.
 *
 * `coveringId` is DERIVED here rather than read off the flag, because
 * auto-cover requires a current window as well as the opt-in. Rendering the
 * flag alone would show an expired 2025 master as active — and quietly
 * covering nothing.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { findCompanyAnnualCoverage, isCoverageCurrent } from '@/lib/orders/annualCoverage'
import {
  ALLOWED_CONTRACT_TYPES,
  readAgreementPdf,
  storePrivateAgreementPdf,
  parseFormDate,
} from '@/lib/agreements/storePdf'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  })
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [rows, coverage] = await Promise.all([
    prisma.companyAgreement.findMany({
      where: { companyId: company.id, deletedAt: null },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, contractType: true, title: true, isAnnual: true, autoCoverJobs: true,
        effectiveDate: true, expiryDate: true, signerName: true, signedAt: true,
        standingLcdwDecision: true,
        originalFilename: true, createdAt: true, deletedAt: true,
        _count: { select: { addenda: true } },
      },
    }),
    findCompanyAnnualCoverage(company.id),
  ])

  const now = new Date()
  return NextResponse.json({
    company,
    coveringId: coverage?.companyAgreementId ?? null,
    agreements: rows.map((a) => ({
      id: a.id,
      contractType: a.contractType,
      title: a.title,
      isAnnual: a.isAnnual,
      autoCoverJobs: a.autoCoverJobs,
      effectiveDate: a.effectiveDate,
      expiryDate: a.expiryDate,
      signerName: a.signerName,
      signedAt: a.signedAt,
      standingLcdwDecision: a.standingLcdwDecision,
      originalFilename: a.originalFilename,
      createdAt: a.createdAt,
      jobsAttached: a._count.addenda,
      // Flagged but NOT covering — the window has lapsed or not opened yet.
      // Surfaced so "why is this client being asked to sign?" is answerable
      // from the page that configured it.
      flaggedButInactive: a.autoCoverJobs && !isCoverageCurrent(a, now),
    })),
  })
}

/**
 * POST /api/crm/companies/[id]/agreements — file a master agreement AT the
 * company, and optionally switch the account onto it in the same step.
 *
 * The job-scoped route can only file a master while attaching a job to it,
 * which quietly made an account impossible to set up until it had booked
 * something. Measured 2026-09-02: Fox Sports had an executed annual agreement
 * in hand and ZERO jobs in HQ, so there was no page anywhere that could
 * accept it. An annual agreement is a COMPANY fact — it is signed before the
 * first job and outlives every one of them — so it is filed here.
 *
 * No job is linked. Jobs attach themselves as addenda through coverage
 * (annualCoverage.ts), which is the whole point of an annual account; a
 * filing route that demanded a job would be re-creating the problem.
 *
 * Auto-cover is accepted in the same request so setup is one action rather
 * than a file-then-remember-to-flip-it. It still cannot ride on a non-annual
 * master — same guard as PATCH, because a one-off master that auto-covers
 * turns a filing mistake into "this company never signs anything".
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const uploader = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Could not read the form.' }, { status: 400 })
  }

  const contractType = (form.get('contractType') || 'RENTAL_AGREEMENT').toString()
  if (!ALLOWED_CONTRACT_TYPES.has(contractType)) {
    return NextResponse.json({ error: 'Invalid agreement type.' }, { status: 400 })
  }

  const parsed = await readAgreementPdf(form.get('file'))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const isAnnual = form.get('isAnnual') === 'true'
  const autoCoverJobs = isAnnual && form.get('autoCoverJobs') === 'true'
  const rawLcdw = (form.get('standingLcdwDecision') || '').toString()
  const standingLcdwDecision =
    rawLcdw === 'ACCEPTED' || rawLcdw === 'DECLINED' ? rawLcdw : null

  const expiryDate = parseFormDate(form, 'expiryDate')
  const effectiveDate = parseFormDate(form, 'effectiveDate')

  // An annual master with no end date never lapses, so nothing would ever
  // hand the signing ask back. Refused rather than defaulted: guessing a term
  // for a contract is not ours to do, and the date is on the document.
  if (autoCoverJobs && !expiryDate) {
    return NextResponse.json(
      { error: 'An auto-covering agreement needs an expiration date — it is on the agreement.' },
      { status: 400 },
    )
  }

  const stored = await storePrivateAgreementPdf(
    `company-agreements/${company.id}`,
    parsed.name,
    parsed.buffer,
  )

  const created = await prisma.companyAgreement.create({
    data: {
      companyId: company.id,
      contractType: contractType as 'RENTAL_AGREEMENT' | 'STAGE_CONTRACT',
      title: (form.get('title') || '').toString().trim().slice(0, 200) || null,
      fileKey: stored.blobKey,
      fileUrl: stored.fileUrl,
      originalFilename: parsed.name,
      fileSize: parsed.size,
      mimeType: 'application/pdf',
      isAnnual,
      autoCoverJobs,
      standingLcdwDecision,
      effectiveDate,
      expiryDate,
      signerName: (form.get('signerName') || '').toString().trim().slice(0, 200) || null,
      signedAt: parseFormDate(form, 'signedDate'),
      note: (form.get('note') || '').toString().trim().slice(0, 2000) || null,
      source: 'INTERNAL',
      uploadedById: uploader?.id ?? null,
    },
    select: { id: true },
  })

  await prisma.auditLog
    .create({
      data: {
        action: 'company_agreement.filed',
        entityType: 'CompanyAgreement',
        entityId: created.id,
        userId: uploader?.id ?? null,
        newValues: {
          companyId: company.id,
          contractType,
          isAnnual,
          autoCoverJobs,
          standingLcdwDecision,
          effectiveDate: effectiveDate?.toISOString() ?? null,
          expiryDate: expiryDate?.toISOString() ?? null,
          originalFilename: parsed.name,
        },
      },
    })
    .catch((err) => console.error('[company-agreement] audit write failed', created.id, err))

  return NextResponse.json({ ok: true, agreementId: created.id })
}
