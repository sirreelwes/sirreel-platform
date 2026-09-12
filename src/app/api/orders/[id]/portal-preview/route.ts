/**
 * GET /api/orders/[id]/portal-preview — "see what they see".
 *
 * Wes 2026-09-12: "is there a button to 'see what they see' on job portal
 * page?" There wasn't, so the only way to look at a client's portal was to
 * open the client's own magic link — which stamps their access row, inflates
 * their open count and tells HQ they read it. This mints a short-lived signed
 * token instead and bounces the staff member to the portal host, which
 * redeems it for a read-only preview cookie (jobPreview.ts).
 *
 * Staff session required; the token lasts ten minutes and grants reading one
 * order's portal. It cannot sign, approve, pay or save anything — the write
 * routes only accept a real client session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { mintJobPreviewToken } from '@/lib/portal/jobPreview'
import { portalBaseUrl } from '@/lib/portal/portalUrl'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { id: true, portalSlug: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!order.portalSlug) {
    return NextResponse.json(
      { error: 'This order has no client portal yet — send the quote first.' },
      { status: 409 },
    )
  }
  const token = mintJobPreviewToken(order.id, session.user.email)
  // Handed over the way the client's own link is: token in the URL, which the
  // portal page exchanges for a cookie and strips.
  return NextResponse.redirect(
    `${portalBaseUrl()}/portal/job/${order.portalSlug}?preview=${encodeURIComponent(token)}`,
  )
}
