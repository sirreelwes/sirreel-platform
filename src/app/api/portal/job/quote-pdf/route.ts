/**
 * GET /api/portal/job/quote-pdf
 *
 * Job-session-gated proxy for the order's quote PDF, mirroring the DOT-sheet
 * and agreement proxies beside it.
 *
 * Why it exists: the portal's "Download quote PDF" link pointed straight at
 * `Order.quotePdfUrl`, which is a PRIVATE blob — it answers 403 to anyone
 * without the store token, so every client who clicked it got nothing while
 * the row above cheerfully read "Available". The quote was the one paperwork
 * item still handing out a raw blob URL; everything else already streamed
 * through a gated route.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: { quotePdfUrl: true },
  })
  if (!order?.quotePdfUrl) return NextResponse.json({ error: 'No quote PDF available' }, { status: 404 })

  return streamPrivateBlobAsResponse({
    fileUrl: order.quotePdfUrl,
    filename: `Quote-${resolved.order.orderNumber}.pdf`,
  })
}
