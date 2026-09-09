/**
 * POST /api/portal/job/annual-request — the client, on their job's
 * paperwork page, asks to be set up on an annual rental agreement.
 *
 * Takes the ask and nothing else: no coverage, no agreement row, no change
 * to what this job's paperwork requires. See src/lib/portal/annualRequest.ts
 * for why this is a request rather than a signature.
 *
 * Cookie-auth'd like every other /api/portal/job route. The company comes
 * off the ORDER, never the request body — a client cannot ask on behalf of
 * an account they do not hold a portal for.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { recordAnnualRequest } from '@/lib/portal/annualRequest'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: { jobId: true, companyId: true },
  })
  if (!order?.companyId) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const contact = resolved.contact
  const request = await recordAnnualRequest({
    companyId: order.companyId,
    jobId: order.jobId,
    personId: contact?.id ?? null,
    name: [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || null,
    email: contact?.email ?? null,
    source: 'JOB_PORTAL',
  })

  return NextResponse.json({ ok: true, requestedAt: request.createdAt.toISOString() })
}
