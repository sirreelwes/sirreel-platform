/**
 * Pure (no-side-effect) composer for the job WELCOME email — the client's
 * link to their job page, sent once the quote is out.
 *
 * Same contract as composePaperworkSummaryEmail: recipient ranking + body
 * render in ONE place, called by both the preview and the send route so
 * they cannot disagree about who it goes to or what it says. Never
 * writes — the magic link is minted by the send route and handed in as
 * `portalLink`; the preview renders the button inert.
 */

import { prisma } from '@/lib/prisma'
import { rankRecipients, type RankedRecipient } from '@/lib/email/recipients'
import { buildJobWelcomeEmail } from '@/lib/email/templates/jobWelcome'
import { SEND_FROM } from '@/lib/email/sendAgreementEmail'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'
import { defaultJobWelcomeBody } from '@/lib/jobs/welcomeReminder'

export interface JobWelcomeCompositionOk {
  ok: true
  to: RankedRecipient
  alternatives: RankedRecipient[]
  from: string
  subject: string
  html: string
  text: string
  attachments: []
  /** Seeded into the compose box — Wes's wording, addressed to `to`. */
  defaultBody: string
  /** The modal header block. The portal order when there is one, else
   *  the job code (composeCardAuthEmail's treatment). */
  order: {
    id: string
    orderNumber: string
    jobName: string | null
    portalSlug: string | null
    validUntil: Date | null
  }
  /** The order whose portalSlug the link is minted on, or null when the
   *  job has no client job page yet (the send refuses in that case). */
  portalOrder: { id: string; portalSlug: string } | null
  orderId: string | null
  portalUrlIsTokenized: boolean
}

export type JobWelcomeComposition =
  | JobWelcomeCompositionOk
  | { ok: false; status: number; error: string }

export interface ComposeJobWelcomeArgs {
  jobId: string
  /** The rep's words, greeting included. Blank → Wes's default. */
  customMessage?: string | null
  /** Person.id override from the modal's recipient picker. */
  overrideContactId?: string | null
  /** Null for a preview; the minted job-page URL for a real send. */
  portalLink?: string | null
}

export async function composeJobWelcomeEmail(
  args: ComposeJobWelcomeArgs,
): Promise<JobWelcomeComposition> {
  const job = await prisma.job.findUnique({
    where: { id: args.jobId },
    select: {
      id: true,
      jobCode: true,
      name: true,
      company: { select: { name: true } },
      agent: { select: { name: true, phone: true, email: true } },
      jobContacts: {
        orderBy: [{ isPrimary: 'desc' }, { role: 'asc' }],
        select: {
          role: true,
          isPrimary: true,
          person: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
      // The link is per-ORDER (portalSlug lives on Order). Newest live
      // order with a client job page wins.
      orders: {
        where: { status: { not: 'CANCELLED' }, archivedAt: null, portalSlug: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, orderNumber: true, portalSlug: true, expiresAt: true },
      },
      bookings: {
        where: { status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { jobName: true },
      },
    },
  })
  if (!job) return { ok: false, status: 404, error: 'job not found' }

  const candidates = rankRecipients({ jobContacts: job.jobContacts }, null)
  if (candidates.length === 0) {
    return {
      ok: false,
      status: 409,
      error: 'No contact with an email address on this job — add one first.',
    }
  }

  let to = candidates[0]
  if (args.overrideContactId) {
    const picked = candidates.find((c) => c.id === args.overrideContactId)
    if (!picked) {
      return { ok: false, status: 400, error: 'overrideContactId is not a contact on this job' }
    }
    to = picked
  }

  const jobName = resolveDisplayJobName({
    jobName: job.name,
    bookingJobName: job.bookings[0]?.jobName ?? null,
    companyName: job.company?.name ?? null,
  })
  const defaultBody = defaultJobWelcomeBody(to.name.split(' ')[0] || null)
  const body = args.customMessage?.trim() || defaultBody

  const { subject, html, text } = buildJobWelcomeEmail({
    jobName,
    body,
    portalLink: args.portalLink ?? null,
    repName: job.agent?.name || 'the SirReel team',
    repPhone: job.agent?.phone || null,
    repEmail: job.agent?.email || null,
  })

  const order = job.orders[0]
  const portalOrder = order?.portalSlug ? { id: order.id, portalSlug: order.portalSlug } : null

  return {
    ok: true,
    to,
    alternatives: candidates,
    from: SEND_FROM,
    subject,
    html,
    text,
    attachments: [],
    defaultBody,
    order: {
      id: order?.id ?? job.id,
      orderNumber: order?.orderNumber ?? job.jobCode,
      jobName,
      portalSlug: order?.portalSlug ?? null,
      validUntil: order?.expiresAt ?? null,
    },
    portalOrder,
    orderId: order?.id ?? null,
    portalUrlIsTokenized: !!args.portalLink,
  }
}
