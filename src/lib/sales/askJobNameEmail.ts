/**
 * The "what should we call this job?" ask — composer + context loader.
 *
 * Wes, 2026-09-02: pressing "Ask client for job name" on Review Quote sent
 * a live email to the client on the first click, with no preview and no way
 * to back out. Every other client-facing send in HQ goes through
 * EmailReviewModal; this one skipped the gate because the route composed
 * and sent in the same handler. Splitting the composition out is what lets
 * the preview endpoint render exactly what the send endpoint will mail.
 *
 * The mechanism itself is unchanged (see the send route's header): a signed
 * details token, the public /details/[token] form, and a ClientDetailReply
 * for a human to accept. Nothing here renames a Job.
 */

import { CLIENT_SIGNOFF } from '@/lib/email/signoff'
import { prisma } from '@/lib/prisma'

export interface AskJobNameContext {
  inquiryId: string
  inquiryTitle: string | null
  toEmail: string
  toName: string
  /** Ask for the production company in the same trip. */
  askForCompany: boolean
  agentName: string
  agentEmail: string
}

/**
 * Resolve who this goes to and what to ask for. The caller may pass the
 * recipient explicitly — on Review Quote the contact often isn't saved yet,
 * so there is no Person row to read.
 */
export async function loadAskJobNameContext(
  inquiryId: string,
  agent: { name: string | null; email: string },
  override: { toEmail?: unknown; toName?: unknown; askForCompany?: unknown },
): Promise<AskJobNameContext> {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    select: {
      id: true,
      title: true,
      person: { select: { firstName: true, email: true } },
      company: { select: { name: true } },
    },
  })
  if (!inquiry) throw new Error('Inquiry not found')

  const toEmail =
    (typeof override.toEmail === 'string' && override.toEmail.trim()) || inquiry.person?.email || ''
  if (!toEmail) throw new Error('No client email on this inquiry — add a contact first.')

  return {
    inquiryId: inquiry.id,
    inquiryTitle: inquiry.title,
    toEmail,
    toName:
      (typeof override.toName === 'string' && override.toName.trim()) ||
      inquiry.person?.firstName ||
      'there',
    askForCompany: override.askForCompany === true || !inquiry.company,
    agentName: agent.name || 'the SirReel team',
    agentEmail: agent.email,
  }
}

/** The editable starting text the rep is handed in the compose box. */
export function askJobNameDefaultBody(askForCompany: boolean): string {
  const wanted = askForCompany ? 'the production name and your company' : 'the production name'
  return `We're putting your quote together. So it lands in the right place, could you tell us ${wanted}?`
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Does the rep's draft already open with a greeting? Then ours stands down. */
const opensWithGreeting = (body: string) => /^\s*(hi|hey|hello)\b/i.test(body)

/**
 * The email. `customMessage` is the rep's words from the review modal and
 * REPLACES the ask paragraph; the link CTA and the sign-off are the shell
 * and stay — without the link there is nothing for the client to fill in.
 */
export function composeAskJobNameEmail(input: {
  ctx: AskJobNameContext
  /** The signed details link. The preview passes a placeholder. */
  url: string
  customMessage?: string | null
}): { subject: string; html: string; text: string } {
  const { ctx, url } = input
  const body = (input.customMessage?.trim() || askJobNameDefaultBody(ctx.askForCompany)).trim()
  const greeting = opensWithGreeting(body) ? '' : `Hi ${ctx.toName},`
  const cta = `Add ${ctx.askForCompany ? 'them' : 'it'} here`

  const subject = 'Quick one — what should we call this job?'

  const text = [
    greeting,
    greeting ? '' : null,
    body,
    '',
    url,
    '',
    "Takes a few seconds — or just reply to this email and we'll add it.",
    '',
    `Thanks,\n${ctx.agentName}\n${CLIENT_SIGNOFF}`,
  ]
    .filter((l) => l !== null)
    .join('\n')

  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')

  const html =
    `<div style="font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1c1917">` +
    (greeting ? `<p>${escapeHtml(greeting)}</p>` : '') +
    paragraphs +
    `<p><a href="${url}" style="color:#b45309;font-weight:700">${cta}</a> — takes a few seconds, or just reply to this email and we'll add it.</p>` +
    `<p>Thanks,<br>${escapeHtml(ctx.agentName)}<br>${CLIENT_SIGNOFF}</p></div>`

  return { subject, html, text }
}
