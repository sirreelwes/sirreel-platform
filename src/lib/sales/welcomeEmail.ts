import { prisma } from '@/lib/prisma'
import { ensureInquiryContact } from '@/lib/inquiries/resolveContact'
import { buildBookingWelcomeEmail } from '@/lib/email/templates/bookingWelcome'
import { portalBaseUrl } from '@/lib/portal/portalUrl'

/**
 * Welcome / Job Begin email composer — shared by /api/sales/welcome/preview
 * and /send so the reviewed draft and the dispatched email can never drift.
 *
 * Composes from the bookingWelcome template with a "Get Paperwork Started"
 * CTA pointing at the click-to-create landing page (/portal/welcome/[token]).
 * COMPOSITION MINTS NOTHING: preview passes a placeholder token; only the
 * send route creates the WelcomeInvite row, and the Job/Order/portal are
 * created only when the CLIENT presses the button on the landing page.
 */

export const WELCOME_CTA_LABEL = 'Get Paperwork Started'
export const WELCOME_INVITE_TTL_DAYS = 7

export function welcomeInviteUrl(token: string): string {
  return `${portalBaseUrl()}/portal/welcome/${token}`
}

export interface WelcomeInquiryContext {
  inquiryId: string
  inquiryTitle: string
  person: { id: string; firstName: string; email: string }
  company: { id: string; name: string }
  agent: { id: string; name: string | null; email: string | null; phone: string | null }
}

/**
 * Load + validate the inquiry for a welcome send. A Job needs a Company and
 * an agent, and the email needs a Person with an address — so the inquiry
 * must be qualified (person + company set) before the welcome can go out.
 * Throws Error with an agent-readable message when a precondition is missing.
 */
export async function loadWelcomeInquiryContext(
  inquiryId: string,
  fallbackAgentEmail: string,
  /** The agent-resolved Job. Used to backfill a missing inquiry company
   *  (the Job already has one) so the send stops failing on a
   *  precondition the agent has effectively already answered. */
  resolvedJobId?: string | null,
): Promise<WelcomeInquiryContext> {
  // Derive the contact from what the inquiry arrived with (Gmail From
  // header / web-form contact block) before demanding one. Every inquiry
  // carried a usable email and NONE had a linked Person, so this
  // precondition used to fail on essentially all of them (Wes 2026-08-25).
  await ensureInquiryContact(inquiryId).catch(() => null)

  if (resolvedJobId) {
    const current = await prisma.inquiry.findUnique({ where: { id: inquiryId }, select: { companyId: true } })
    if (!current?.companyId) {
      const job = await prisma.job.findUnique({ where: { id: resolvedJobId }, select: { companyId: true } })
      if (job?.companyId) {
        await prisma.inquiry.update({ where: { id: inquiryId }, data: { companyId: job.companyId } })
      }
    }
  }

  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    select: {
      id: true,
      title: true,
      convertedJobId: true,
      person: { select: { id: true, firstName: true, email: true } },
      company: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true, email: true, phone: true } },
    },
  })
  if (!inquiry) throw new Error('Inquiry not found')
  if (inquiry.convertedJobId) throw new Error('This inquiry already has a job — the welcome invite is for pre-job inquiries.')
  if (!inquiry.person?.email) {
    throw new Error('Set the inquiry contact (person with an email) before sending the welcome.')
  }
  if (!inquiry.company) {
    throw new Error('Set the inquiry company before sending the welcome — the job needs one.')
  }
  // Agent: the inquiry's assignee, else the sending agent.
  let agent = inquiry.assignedTo
  if (!agent) {
    agent = await prisma.user.findUnique({
      where: { email: fallbackAgentEmail },
      select: { id: true, name: true, email: true, phone: true },
    })
  }
  if (!agent) throw new Error('No agent resolved for this inquiry.')

  return {
    inquiryId: inquiry.id,
    inquiryTitle: inquiry.title,
    person: { id: inquiry.person.id, firstName: inquiry.person.firstName, email: inquiry.person.email },
    company: { id: inquiry.company.id, name: inquiry.company.name },
    agent,
  }
}

export function composeWelcomeEmail(args: {
  ctx: WelcomeInquiryContext
  inviteUrl: string
  personalNote?: string | null
  customMessage?: string | null
  /** Quick Respond: an empty box means an empty body, not the default prose. */
  suppressDefaultBody?: boolean
}): { subject: string; html: string; text: string } {
  return buildBookingWelcomeEmail({
    firstName: args.ctx.person.firstName,
    projectName: args.ctx.inquiryTitle,
    portalLink: args.inviteUrl,
    repName: args.ctx.agent.name || 'the SirReel team',
    repPhone: args.ctx.agent.phone,
    repEmail: args.ctx.agent.email,
    personalNote: args.personalNote ?? null,
    customMessage: args.customMessage ?? null,
    suppressDefaultBody: args.suppressDefaultBody ?? false,
    ctaLabel: WELCOME_CTA_LABEL,
  })
}
