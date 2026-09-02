/**
 * GET /api/portal/job/agreement/annual — the client reads the annual master
 * their job is papered by.
 *
 * "Covered — nothing to sign" is only fair if the client can see WHAT they
 * are covered by. The master lives in the private blob store (a direct fetch
 * 403s), so it is served through this job-session-gated proxy exactly like
 * the quote PDF, the DOT sheet and the agreement PDF.
 *
 * Serves only the master that is CURRENTLY covering this order's company —
 * resolved fresh, not from a client-supplied id — so a portal session can
 * never be used to enumerate a company's filed agreements.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { findCompanyAnnualCoverage, annualCoverageTitle } from '@/lib/orders/annualCoverage'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })

  const coverage = await findCompanyAnnualCoverage(resolved.order.company.id)
  if (!coverage) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const agreement = await prisma.companyAgreement.findUnique({
    where: { id: coverage.companyAgreementId },
    select: { fileUrl: true, originalFilename: true },
  })
  if (!agreement) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const download = req.nextUrl.searchParams.get('download') === '1'
  return streamPrivateBlobAsResponse({
    fileUrl: agreement.fileUrl,
    filename: `${annualCoverageTitle(coverage).replace(/[^A-Za-z0-9 ._-]+/g, '')}.pdf`,
    forceDownload: download,
  })
}
