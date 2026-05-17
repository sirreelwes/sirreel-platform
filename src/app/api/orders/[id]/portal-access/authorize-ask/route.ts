import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { signAuthorizeToken } from '@/lib/portal/authorizeToken'
import { sendCadenceEmail } from '@/lib/email/sendCadenceEmail'
import { ADD_CONTACT_AUTHORIZATION_TEMPLATE } from '@/lib/email/templates/cadenceTemplates'

export const dynamic = 'force-dynamic'

/**
 * POST /api/orders/[id]/portal-access/authorize-ask
 *
 * Body:
 *   { existingContactId, newEmail, newFirstName?, newLastName? }
 *
 * Sends the "Quick question — adding {newContactName} to the {jobName}
 * portal" email (template ADD_CONTACT_AUTHORIZATION_TEMPLATE) to an
 * existing contact, with signed [Yes][No] links. The token carries enough
 * payload that the click-through can act without a separate session.
 *
 * The existing contact does NOT need a PortalAccess — they're acting as a
 * gatekeeper, not opening the portal. They just need to be a known Person.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    existingContactId?: unknown
    newEmail?: unknown
    newFirstName?: unknown
    newLastName?: unknown
  }
  const existingContactId = typeof body.existingContactId === 'string' ? body.existingContactId : ''
  const newEmail = typeof body.newEmail === 'string' ? body.newEmail.trim().toLowerCase() : ''
  const newFirstName = typeof body.newFirstName === 'string' ? body.newFirstName.trim() : ''
  const newLastName = typeof body.newLastName === 'string' ? body.newLastName.trim() : ''
  if (!existingContactId) {
    return NextResponse.json({ error: 'existingContactId required' }, { status: 400 })
  }
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return NextResponse.json({ error: 'Valid newEmail required' }, { status: 400 })
  }

  const [order, requester] = await Promise.all([
    prisma.order.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        portalSlug: true,
        job: { select: { name: true, jobCode: true } },
        company: { select: { name: true } },
        agent: { select: { name: true, email: true, phone: true } },
      },
    }),
    prisma.person.findUnique({
      where: { id: existingContactId },
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
  ])
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!requester) return NextResponse.json({ error: 'Existing contact not found' }, { status: 404 })
  if (!requester.email) return NextResponse.json({ error: 'Existing contact has no email' }, { status: 400 })

  const token = signAuthorizeToken({
    orderId: order.id,
    requesterContactId: requester.id,
    newEmail,
    newFirstName: newFirstName || undefined,
    newLastName: newLastName || undefined,
  })
  const base = 'https://hq.sirreel.com/api/portal/authorize'
  const approveLink = `${base}/${encodeURIComponent(token)}?action=approve`
  const declineLink = `${base}/${encodeURIComponent(token)}?action=decline`

  const newContactName = [newFirstName, newLastName].filter(Boolean).join(' ') || newEmail
  const result = await sendCadenceEmail({
    template: ADD_CONTACT_AUTHORIZATION_TEMPLATE,
    label: 'portal/authorize-ask',
    to: [requester.email],
    context: {
      firstName: requester.firstName,
      jobName: order.job?.name || order.company?.name || '',
      newContactName,
      approveLink,
      declineLink,
      repName: order.agent?.name || 'the SirReel team',
      repPhone: order.agent?.phone || '',
    },
  })

  return NextResponse.json({
    ok: result.ok,
    emailResult: result,
    // Useful for the rep UI to surface the same links if email fails.
    approveLink,
    declineLink,
  })
}
