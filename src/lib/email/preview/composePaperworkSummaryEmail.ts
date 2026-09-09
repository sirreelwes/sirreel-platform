/**
 * Pure (no-side-effect) composer for the client paperwork summary.
 *
 * Same contract as composeCardAuthEmail / composeQuoteEmail: recipient
 * ranking + body render in ONE place, called by both the preview and the
 * send route so the two cannot disagree about who it goes to or what it
 * says. The composer never writes — in particular it never mints a
 * magic link, which is why the preview renders the rows without live
 * buttons instead of with dead ones.
 */

import { prisma } from '@/lib/prisma'
import { rankRecipients, type RankedRecipient } from '@/lib/email/recipients'
import {
  buildClientPaperworkSummary,
  type ClientPaperworkSummary,
  type PaperworkDestination,
} from '@/lib/paperwork/clientPaperworkSummary'
import {
  buildPaperworkSummaryEmail,
  type PaperworkSummaryRow,
} from '@/lib/email/templates/paperworkSummary'
import { SEND_FROM } from '@/lib/email/sendAgreementEmail'

/**
 * The client's live destinations, resolved by the SEND route (which holds
 * the minted token). Null for a preview.
 *
 * Two shapes, because a job may not have a client job page yet: an order
 * with a portalSlug gets the full job page (paperwork section, drivers
 * section, LCDW sub-page); a job that has only a hold falls back to the
 * v2 paperwork portal, which has one screen and no anchors.
 */
export interface PaperworkSummaryLinks {
  /** Where the CTA button lands. */
  home: string
  /** True when `home` is the job page — the only surface with #paperwork
   *  / #drivers anchors and a /lcdw sub-page to deep-link into. */
  jobPage: boolean
  /** Absolute URL of the job page's LCDW screen, when there is one. */
  lcdw: string | null
}

export interface PaperworkSummaryCompositionOk {
  ok: true
  to: RankedRecipient
  alternatives: RankedRecipient[]
  from: string
  subject: string
  html: string
  text: string
  attachments: []
  /** The modal header block. Falls back to the job code when the job has
   *  no order yet — same treatment composeCardAuthEmail gives it. */
  order: {
    id: string
    orderNumber: string
    jobName: string | null
    portalSlug: string | null
    validUntil: Date | null
  }
  /** The REAL Order id, or null — anchoring an EmailDelivery to a job id
   *  would be a bogus FK. */
  orderId: string | null
  portalUrlIsTokenized: boolean
  /** The derived checklist, so the staff surface can show what is about
   *  to go out without re-deriving it. */
  summary: ClientPaperworkSummary
  /** Nothing is outstanding — the caller warns before sending an email
   *  whose only content is "you're all set". */
  nothingOutstanding: boolean
}

export type PaperworkSummaryComposition =
  | PaperworkSummaryCompositionOk
  | { ok: false; status: number; error: string }

export interface ComposePaperworkSummaryArgs {
  jobId: string
  /** Rep's note, rendered above the lists. */
  message?: string | null
  /** "Write my own email" — replaces the templated opener. The lists,
   *  the button and the sign-off stay: they ARE the email. */
  customMessage?: string | null
  /** Person.id override from the modal's recipient picker. Must be one of
   *  the ranked candidates on this job. */
  overrideContactId?: string | null
  /** Null for a preview; the minted destinations for a real send. */
  links?: PaperworkSummaryLinks | null
}

function hrefFor(dest: PaperworkDestination, links: PaperworkSummaryLinks | null): string | null {
  if (!links) return null
  if (!links.jobPage) return links.home
  if (dest === 'lcdw') return links.lcdw ?? links.home
  // `home` carries ?token=…, so the hash appends cleanly.
  return `${links.home}#${dest === 'drivers' ? 'drivers' : 'paperwork'}`
}

export async function composePaperworkSummaryEmail(
  args: ComposePaperworkSummaryArgs,
): Promise<PaperworkSummaryComposition> {
  const job = await prisma.job.findUnique({
    where: { id: args.jobId },
    select: {
      id: true,
      jobCode: true,
      name: true,
      agent: { select: { name: true, phone: true } },
      jobContacts: {
        orderBy: [{ isPrimary: 'desc' }, { role: 'asc' }],
        select: {
          role: true,
          isPrimary: true,
          person: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
      orders: {
        where: { status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, orderNumber: true, portalSlug: true, expiresAt: true },
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

  const summary = await buildClientPaperworkSummary(job.id)
  if (!summary) return { ok: false, status: 404, error: 'job not found' }

  const links = args.links ?? null
  const rows: PaperworkSummaryRow[] = summary.items.map((i) => ({
    label: i.label,
    state: i.state,
    status: i.status,
    detail: i.detail,
    href: i.link ? hrefFor(i.link, links) : null,
  }))

  const { subject, html, text } = buildPaperworkSummaryEmail({
    firstName: to.name.split(' ')[0] || null,
    jobName: summary.jobName,
    rows,
    portalLink: links?.home ?? null,
    agentFirstName: (job.agent?.name || '').split(' ')[0] || null,
    agentPhone: job.agent?.phone || null,
    personalNote: args.message ?? null,
    customBody: args.customMessage?.trim() || null,
  })

  const order = job.orders[0]

  return {
    ok: true,
    to,
    alternatives: candidates,
    from: SEND_FROM,
    subject,
    html,
    text,
    attachments: [],
    order: {
      id: order?.id ?? job.id,
      orderNumber: order?.orderNumber ?? job.jobCode,
      jobName: summary.jobName,
      portalSlug: order?.portalSlug ?? null,
      validUntil: order?.expiresAt ?? null,
    },
    orderId: order?.id ?? null,
    portalUrlIsTokenized: !!links,
    summary,
    nothingOutstanding: summary.outstanding.length === 0,
  }
}
