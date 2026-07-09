import { prisma } from '@/lib/prisma'
import { issueJobMagicLink } from '@/lib/portal/jobMagicLink'
import { sendAgreementEmail, type EmailResult } from '@/lib/email/sendAgreementEmail'
import { recordEmailDelivery } from '@/lib/email/recordEmailDelivery'
import { buildPortalInviteEmail } from '@/lib/email/templates/portalInvite'
import { portalJobUrl } from '@/lib/portal/portalUrl'
import { normalizeEmail, resolvePersonByEmail } from '@/lib/people/email'

/**
 * Shared portal-invite core — find-or-create the Person, mint a PortalAccess
 * + 7-day magic link, and email the portal URL with the portalInvite
 * template. Extracted VERBATIM from POST /orders/[id]/portal-access/invite
 * (route files can't export helpers) so the "Send Paperwork Portal" compose
 * action reuses the exact same invite behavior — one code path, no drift.
 *
 * Throws Error with a human-readable message on bad email / missing order /
 * missing portal slug; the caller maps those to 4xx.
 */
export interface PortalInviteResult {
  portalUrl: string
  person: { id: string; firstName: string; lastName: string; email: string }
  portalAccessId: string
  emailResult: EmailResult
}

export async function sendPortalInvite(args: {
  orderId: string
  email: string
  firstName?: string
  lastName?: string
}): Promise<PortalInviteResult> {
  const email = normalizeEmail(args.email || '')
  const firstName = (args.firstName || '').trim()
  const lastName = (args.lastName || '').trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Valid email required')
  }

  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      portalSlug: true,
      job: { select: { name: true, jobCode: true } },
      company: { select: { name: true } },
      agent: { select: { name: true, email: true, phone: true } },
    },
  })
  if (!order) throw new Error('Order not found')
  if (!order.portalSlug) throw new Error('Order has no portal slug')

  // Find-or-create Person via the alias-aware resolver — if the given
  // email was merged into a survivor previously, we want the survivor's
  // row back, not a fresh Person.
  const existingPerson = (await resolvePersonByEmail(email, {
    select: { id: true, firstName: true, lastName: true, email: true },
  })) as { id: string; firstName: string; lastName: string; email: string } | null
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

  const issued = await issueJobMagicLink({ orderId: order.id, contactId: person.id })
  const portalUrl = portalJobUrl(order.portalSlug, issued.token)

  const jobLabel = order.job?.name || order.company?.name || ''
  const tpl = buildPortalInviteEmail({
    firstName: person.firstName,
    projectName: jobLabel,
    portalLink: portalUrl,
    repName: order.agent?.name || 'the SirReel team',
    repPhone: order.agent?.phone || null,
    repEmail: order.agent?.email || null,
  })
  const emailResult = await sendAgreementEmail({
    label: 'portal/invite',
    to: [person.email],
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  })
  if (emailResult.ok && emailResult.id) {
    await recordEmailDelivery({
      resendMessageId: emailResult.id,
      toAddress: person.email,
      subject: tpl.subject,
      label: 'portal/invite',
      orderId: order.id,
    })
  }

  return { portalUrl, person, portalAccessId: issued.portalAccessId, emailResult }
}
