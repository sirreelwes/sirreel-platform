import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

// GET /api/agreements/company/[id] — authed team download of an on-file
// (master / annual) agreement PDF. Private-blob proxy; agreements are
// sensitive contract docs.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const agreement = await prisma.companyAgreement.findUnique({
    where: { id: params.id },
    select: { fileUrl: true, originalFilename: true, deletedAt: true },
  })
  if (!agreement || agreement.deletedAt) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return streamPrivateBlobAsResponse({ fileUrl: agreement.fileUrl, filename: agreement.originalFilename })
}

/**
 * PATCH /api/agreements/company/[id] — set the annual-account flags on a
 * filed master: whether it auto-covers the company's jobs, and its coverage
 * window.
 *
 * This is the switch that turns a company into an "annual account" (Wes,
 * 2026-09-01). Flipping it on stops asking that company's clients to sign a
 * rental agreement per job; flipping it off starts asking again. Both
 * directions take effect on the next portal read — applyAnnualCoverage
 * re-derives the pointer every time rather than trusting a stamped value —
 * so a master switched off mid-job hands the ask straight back rather than
 * leaving jobs papered by a document we no longer stand behind.
 *
 * Every change is audited. "Why did this client never sign?" has to be
 * answerable a year later, and the answer is a person and a date.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })

  const existing = await prisma.companyAgreement.findUnique({
    where: { id: params.id },
    select: {
      id: true, companyId: true, isAnnual: true, autoCoverJobs: true,
      effectiveDate: true, expiryDate: true, deletedAt: true,
    },
  })
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    autoCoverJobs?: unknown
    isAnnual?: unknown
    effectiveDate?: unknown
    expiryDate?: unknown
    title?: unknown
  }

  const parseDate = (v: unknown): Date | null | undefined => {
    if (v === undefined) return undefined
    if (v === null || v === '') return null
    const d = new Date(String(v))
    return Number.isNaN(d.getTime()) ? undefined : d
  }

  const data: Record<string, unknown> = {}
  if (typeof body.isAnnual === 'boolean') data.isAnnual = body.isAnnual
  if (typeof body.title === 'string') data.title = body.title.trim().slice(0, 200) || null
  const eff = parseDate(body.effectiveDate)
  if (eff !== undefined) data.effectiveDate = eff
  const exp = parseDate(body.expiryDate)
  if (exp !== undefined) data.expiryDate = exp

  if (typeof body.autoCoverJobs === 'boolean') {
    const willBeAnnual = typeof data.isAnnual === 'boolean' ? data.isAnnual : existing.isAnnual
    // Same guard as the file-new path: auto-cover is meaningless on a one-off
    // master, and allowing it there turns a filing mistake into a
    // company-wide "nobody signs anything" mistake.
    if (body.autoCoverJobs && !willBeAnnual) {
      return NextResponse.json(
        { error: 'Mark the agreement as annual before it can auto-cover this company’s jobs.' },
        { status: 400 },
      )
    }
    data.autoCoverJobs = body.autoCoverJobs
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const updated = await prisma.companyAgreement.update({
    where: { id: existing.id },
    data,
    select: {
      id: true, title: true, isAnnual: true, autoCoverJobs: true,
      effectiveDate: true, expiryDate: true,
    },
  })

  await prisma.auditLog
    .create({
      data: {
        action: 'company_agreement.coverage_updated',
        entityType: 'CompanyAgreement',
        entityId: existing.id,
        userId: user?.id ?? null,
        oldValues: {
          isAnnual: existing.isAnnual,
          autoCoverJobs: existing.autoCoverJobs,
          effectiveDate: existing.effectiveDate?.toISOString() ?? null,
          expiryDate: existing.expiryDate?.toISOString() ?? null,
        },
        newValues: {
          isAnnual: updated.isAnnual,
          autoCoverJobs: updated.autoCoverJobs,
          effectiveDate: updated.effectiveDate?.toISOString() ?? null,
          expiryDate: updated.expiryDate?.toISOString() ?? null,
        },
      },
    })
    .catch((err) => console.error('[company-agreement] audit write failed', existing.id, err))

  return NextResponse.json({ ok: true, agreement: updated })
}
