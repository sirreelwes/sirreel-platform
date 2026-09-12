/**
 * GET /api/portal/job/dot-sheet
 *
 * Job-session-gated proxy for the order's DOT info packet on the native
 * client portal. Cookie-auth'd (JOB_SESSION_COOKIE) like the agreement
 * proxy. The DOT PDF is a PRIVATE blob that 403s in the client's browser;
 * this streams it via the shared streamPrivateBlobAsResponse helper — never
 * a public URL.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { resolveJobPortalRead } from '@/lib/portal/jobPreview'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const read = await resolveJobPortalRead(req)
  if (!read) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const resolved = read.resolved
  if (!resolved) return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })

  const order = await prisma.order.findUnique({ where: { id: resolved.orderId }, select: { dotSheetPdfUrl: true } })
  if (!order?.dotSheetPdfUrl) return NextResponse.json({ error: 'No DOT sheet available' }, { status: 404 })

  return streamPrivateBlobAsResponse({ fileUrl: order.dotSheetPdfUrl, filename: `DOT-${resolved.order.orderNumber}.pdf` })
}
