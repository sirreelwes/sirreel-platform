import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { issueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { buildPortalInviteEmail } from '@/lib/email/templates/portalInvite'
import { portalJobUrl } from '@/lib/portal/portalUrl'
import type { JobRole } from '@prisma/client'
import { normalizeEmail, resolvePersonByEmail } from '@/lib/people/email'

export const dynamic = 'force-dynamic'

const VALID_ROLES: JobRole[] = ['PRODUCER', 'PM', 'PC', 'TRANSPO', 'ACCOUNTING', 'OTHER']

/**
 * POST /api/orders/[id]/contacts
 *
 * One-shot "add a contact to this order" used by the inline form on the
 * Order detail page. The order must belong to a Job (it always does in
 * the current schema). Body:
 *
 *   {
 *     email: string,           // required
 *     firstName?: string,
 *     lastName?: string,
 *     role?: JobRole,          // default PRODUCER
 *     grantPortalAccess?: boolean  // default true
 *   }
 *
 * Behavior:
 *   1. Find-or-create Person by email (email is unique on the model).
 *   2. Find-or-create JobContact (Job + Person + role tuple is unique).
 *   3. If grantPortalAccess: mint a PortalAccess + 7-day magic link, send
 *      the portal invite email. If the contact already has an active
 *      access on this order, no duplicate is issued.
 *
 * Returns the resulting Person id, JobContact creation flag, PortalAccess
 * id (when issued), portal URL, and the email send result so the page can
 * surface failures inline.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    email?: unknown
    firstName?: unknown
    lastName?: unknown
    role?: unknown
    grantPortalAccess?: unknown
  }
  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '')
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : ''
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : ''
  const roleInput = typeof body.role === 'string' ? body.role : 'PRODUCER'
  const role: JobRole = (VALID_ROLES as readonly string[]).includes(roleInput)
    ? (roleInput as JobRole)
    : 'PRODUCER'
  const grantPortalAccess = body.grantPortalAccess !== false // default true

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      jobId: true,
      portalSlug: true,
      job: { select: { id: true, name: true } },
      company: { select: { name: true } },
      agent: { select: { name: true, email: true, phone: true } },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!order.jobId) {
    return NextResponse.json({ error: 'Order is not linked to a job — cannot add contact' }, { status: 409 })
  }

  // Step 1: find-or-create Person via the alias-aware resolver so a
  // merged loser's email lands on the survivor, not a fresh row.
  const existingPerson = await resolvePersonByEmail(email, {
    select: { id: true, firstName: true, lastName: true, email: true },
  }) as { id: string; firstName: string; lastName: string; email: string } | null
  let person: { id: string; firstName: string; lastName: string; email: string }
  if (existingPerson) {
    if (firstName || lastName) {
      person = await prisma.person.update({
        where: { id: existingPerson.id },
        data: {
          firstName: firstName || undefined,
          lastName: lastName || undefined,
        },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    } else {
      person = existingPerson
    }
  } else {
    person = await prisma.person.create({
      data: {
        email,
        firstName: firstName || email.split('@')[0],
        lastName: lastName || '—',
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    })
  }

  // Step 2: find-or-create JobContact (unique on jobId+personId+role)
  const existingJobContact = await prisma.jobContact.findUnique({
    where: {
      jobId_personId_role: {
        jobId: order.jobId,
        personId: person.id,
        role,
      },
    },
    select: { id: true },
  })
  const jobContactCreated = !existingJobContact
  if (!existingJobContact) {
    await prisma.jobContact.create({
      data: {
        jobId: order.jobId,
        personId: person.id,
        role,
        // First contact added to the job is treated as primary so the
        // RecipientLine has a sensible default highlight target. The user
        // can still override via the existing JobContact admin UI.
        isPrimary: (await prisma.jobContact.count({ where: { jobId: order.jobId } })) === 0,
      },
    })
  }

  // Step 3: optionally mint portal access + send invite
  let portalUrl: string | null = null
  let portalAccessId: string | null = null
  let emailResult: unknown = null
  if (grantPortalAccess) {
    const existingAccess = await prisma.portalAccess.findFirst({
      where: { orderId: order.id, contactId: person.id, revokedAt: null },
      select: { id: true },
    })
    if (!existingAccess && order.portalSlug) {
      const issued = await issueJobMagicLink({ orderId: order.id, contactId: person.id })
      portalAccessId = issued.portalAccessId
      portalUrl = portalJobUrl(order.portalSlug, issued.token)

      const tpl = buildPortalInviteEmail({
        firstName: person.firstName,
        projectName: order.job?.name || order.company?.name || '',
        portalLink: portalUrl,
        repName: order.agent?.name || 'the SirReel team',
        repPhone: order.agent?.phone || null,
        repEmail: order.agent?.email || null,
      })
      emailResult = await sendAgreementEmail({
        label: 'orders/contacts/invite',
        to: [person.email],
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      })
    }
  }

  return NextResponse.json({
    ok: true,
    person,
    jobContactCreated,
    portalAccessId,
    portalUrl,
    emailResult,
  })
}
