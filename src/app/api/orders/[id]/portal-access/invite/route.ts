import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { sendPortalInvite } from '@/lib/portal/sendPortalInvite'

export const dynamic = 'force-dynamic'

/**
 * POST /api/orders/[id]/portal-access/invite
 *
 * Rep-side direct invite. Body:
 *   { email: string, firstName?: string, lastName?: string }
 *
 * Find-or-creates a Person by email, mints a PortalAccess + 7-day magic-link
 * token, and emails the magic link directly to the contact. Returns the
 * portal URL so the rep can copy it if email delivery is unverified (Resend
 * domain status is what makes this best-effort today).
 *
 * Core logic lives in src/lib/portal/sendPortalInvite.ts (shared verbatim
 * with the "Send Paperwork Portal" compose action — one invite path).
 *
 * `regenerate` behavior from /portal-access POST is separate — that endpoint
 * is for "regenerate the existing access for a known contact". This endpoint
 * is for "I have an email address, set them up from scratch."
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: unknown
    firstName?: unknown
    lastName?: unknown
  }

  try {
    const result = await sendPortalInvite({
      orderId: params.id,
      email: typeof body.email === 'string' ? body.email : '',
      firstName: typeof body.firstName === 'string' ? body.firstName : undefined,
      lastName: typeof body.lastName === 'string' ? body.lastName : undefined,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invite failed'
    const status = msg === 'Order not found' ? 404 : msg === 'Order has no portal slug' ? 409 : 400
    return NextResponse.json({ error: msg }, { status })
  }
}
