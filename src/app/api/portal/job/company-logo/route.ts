/**
 * GET /api/portal/job/company-logo — the production company's mark, for
 * the job portal's masthead (2026-09-11: the job page now carries the
 * account portal's masthead — their mark left, ours right).
 *
 * Gated by the JOB session rather than the company one: the person on a
 * job portal usually has no account-portal seat, and the company id is
 * never in the URL, so nothing about the company → client mapping becomes
 * enumerable. A vector mark is served from the row (works on a dev box with
 * no blob token); a raster one streams from the private store. Cached
 * privately for an hour, same as the account portal's copy.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { resolveJobPortalRead } from '@/lib/portal/jobPreview'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import { svgResponse } from '@/lib/companies/logoSvg'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const read = await resolveJobPortalRead(req)
  if (!read) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const resolved = read.resolved
  if (!resolved) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const company = await prisma.company.findUnique({
    where: { id: resolved.order.company.id },
    select: { logoUrl: true, logoSvg: true, name: true },
  })
  if (company?.logoSvg) return svgResponse(company.logoSvg)
  if (!company?.logoUrl) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const res = await streamPrivateBlobAsResponse({
    fileUrl: company.logoUrl,
    filename: `${company.name.replace(/[^A-Za-z0-9._-]+/g, '-')}-logo`,
  })
  res.headers.set('Cache-Control', 'private, max-age=3600')
  return res
}
