import { prisma } from '@/lib/prisma'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { renderEmailShell, renderEmailText, detailTable, calloutBox } from '@/lib/email/templates/shell'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'
import { deriveOrderWindow } from '@/lib/jobs/dateRange'

/**
 * Internal notification when a client submits paperwork through the HQ
 * portal (the /api/portal/[token]/sign steps).
 *
 * WHY: the legacy Cognito forms emailed the team one notification per
 * submitted form ("Credit Card | Miniac Films | Etsy"), and the team runs
 * on those. The HQ portal replaced the forms but sent NOTHING — a client
 * could sign the agreement and authorize a card and nobody would know
 * until someone happened to open the job. With the Cognito → portal
 * redirect landing 2026-09-01, the silence would have swallowed the
 * exact notifications the team is used to (Wes, 2026-08-20).
 *
 * One email per submitted step, mirroring the Cognito cadence and subject
 * shape, sent to HQ_NOTIFY_INBOX (hq@ — outbound-only distribution group:
 * wes/jose/oliver; replies compose from each member's own address).
 * replyTo is the client so Reply answers them directly, same as the
 * public-form notifications (src/lib/email/notifyPublicSubmission.ts).
 *
 * FIRE AND FORGET — callers must NOT await. The paperwork row is already
 * written; a Resend outage must never fail or delay the client's submit.
 * This module does its own DB read (token → booking → job) off the
 * request path for the same reason.
 */

// Audience: the 'hq-documents' notification channel (admin-managed at
// /admin/notifications; defaults to HQ_NOTIFY_INBOX / hq@sirreel.com).
const HQ_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')

export type PaperworkStep = 'agreement' | 'lcdw' | 'cc' | 'studio'

const STEP_LABEL: Record<PaperworkStep, string> = {
  agreement: 'Rental agreement signed',
  lcdw: 'LCDW decision submitted',
  cc: 'Card authorization submitted',
  studio: 'Studio contract signed',
}

export interface PortalPaperworkEvent {
  token: string
  step: PaperworkStep
  /** Step-specific label/value rows (signer, card last4, preference…). */
  details?: Array<{ label: string; value: string }>
}

export function notifyPortalPaperwork(ev: PortalPaperworkEvent): void {
  void send(ev).catch((err) =>
    console.error(`[notify:paperwork:${ev.step}] threw (submission unaffected):`, err),
  )
}

async function send(ev: PortalPaperworkEvent): Promise<void> {
  const request = await prisma.paperworkRequest.findUnique({
    where: { token: ev.token },
    select: {
      sentTo: true,
      booking: {
        select: {
          bookingNumber: true,
          jobName: true,
          jobId: true,
          startDate: true,
          endDate: true,
          company: { select: { name: true } },
          person: { select: { firstName: true, lastName: true, email: true } },
        },
      },
    },
  })
  if (!request?.booking) return
  const b = request.booking

  const company = b.company?.name?.trim() || '—'
  const label = STEP_LABEL[ev.step]
  // Cognito muscle memory: "Credit Card | Miniac Films | Etsy". Keep the
  // pipe shape so the team's eyes and filters keep working.
  const subject = `${label} | ${company} | ${b.jobName}`

  // The job page is where signed paperwork is retrieved — deep-link it.
  // jobId is effectively always set now (orders require it; the Planyo
  // import links every booking), but a legacy row without one still gets
  // a working link to the jobs list rather than /jobs/null.
  const link = b.jobId ? `${HQ_APP_URL}/jobs/${b.jobId}` : `${HQ_APP_URL}/jobs`

  const fmt = (d: Date | null) =>
    d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'
  const rows = [
    { label: 'Job', value: b.jobName },
    { label: 'Company', value: company },
    {
      label: 'Client',
      value:
        [b.person?.firstName, b.person?.lastName].filter(Boolean).join(' ') ||
        request.sentTo ||
        '—',
    },
    { label: 'Dates', value: `${fmt(b.startDate)} → ${fmt(b.endDate)}` },
    { label: 'Booking', value: b.bookingNumber },
    ...(ev.details ?? []),
  ]

  const html = renderEmailShell({
    eyebrow: 'Portal paperwork',
    heading: label,
    preheader: `${company} · ${b.jobName}`,
    bodyHtml: [
      detailTable(rows),
      calloutBox(
        'Signed documents live on the job page. Replying to this email goes straight to the client.',
      ),
    ].join(''),
    cta: { label: 'Open the job in HQ', href: link },
  })
  const text = renderEmailText([subject, '', ...rows.map((r) => `${r.label}: ${r.value}`), '', link])

  const clientEmail = request.sentTo?.trim()
  await sendAgreementEmail({
    to: await channelRecipients('hq-documents'),
    subject,
    html,
    text,
    replyTo: clientEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail) ? clientEmail : undefined,
    label: `paperwork-submitted:${ev.step}:${ev.token.slice(0, 8)}`,
  })
}

/**
 * The JOB-portal twin of notifyPortalPaperwork.
 *
 * The job portal (/portal/job/[slug]) has no PaperworkRequest token — it is
 * keyed to the Job and answers from the ORDER — so the token-based sender
 * above can never fire for it, and until 2026-09-05 a client's LCDW election
 * there reached nobody: Subplot elected the waiver, approved the quote, and
 * the only trace was an audit row. Same subject shape, same channel, same
 * fire-and-forget posture; only the lookup differs.
 */
export interface JobPortalPaperworkEvent {
  jobId: string
  step: PaperworkStep
  /** Reply-To target — the contact who submitted. */
  clientEmail?: string | null
  details?: Array<{ label: string; value: string }>
}

export function notifyJobPortalPaperwork(ev: JobPortalPaperworkEvent): void {
  void sendForJob(ev).catch((err) =>
    console.error(`[notify:paperwork:job:${ev.step}] threw (submission unaffected):`, err),
  )
}

async function sendForJob(ev: JobPortalPaperworkEvent): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: ev.jobId },
    select: {
      id: true,
      name: true,
      jobCode: true,
      company: { select: { name: true } },
      bookings: { select: { jobName: true }, take: 1, orderBy: { createdAt: 'asc' } },
      orders: {
        where: { archivedAt: null, status: { notIn: ['CANCELLED', 'CLOSED'] } },
        select: {
          orderNumber: true,
          startDate: true,
          endDate: true,
          lineItems: { select: { pickupDate: true, returnDate: true } },
          booking: { select: { startDate: true, endDate: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!job) return

  const company = job.company?.name?.trim() || '—'
  const jobName = resolveDisplayJobName({
    jobName: job.name,
    bookingJobName: job.bookings[0]?.jobName,
    companyName: job.company?.name,
  })
  const label = STEP_LABEL[ev.step]
  const subject = `${label} | ${company} | ${jobName}`
  const link = `${HQ_APP_URL}/jobs/${job.id}`

  const fmt = (d: Date | null) =>
    d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'
  const windows = job.orders.map((o) => deriveOrderWindow(o))
  const starts = windows.map((w) => w.start).filter((d): d is Date => !!d)
  const ends = windows.map((w) => w.end).filter((d): d is Date => !!d)
  const start = starts.length ? new Date(Math.min(...starts.map(Number))) : null
  const end = ends.length ? new Date(Math.max(...ends.map(Number))) : null

  const rows = [
    { label: 'Job', value: `${jobName}${job.jobCode ? ` (${job.jobCode})` : ''}` },
    { label: 'Company', value: company },
    { label: 'Client', value: ev.clientEmail?.trim() || '—' },
    { label: 'Dates', value: `${fmt(start)} → ${fmt(end)}` },
    { label: 'Orders', value: job.orders.map((o) => o.orderNumber).join(', ') || '—' },
    ...(ev.details ?? []),
  ]

  const html = renderEmailShell({
    eyebrow: 'Portal paperwork',
    heading: label,
    preheader: `${company} · ${jobName}`,
    bodyHtml: [
      detailTable(rows),
      calloutBox(
        'Signed documents live on the job page. Replying to this email goes straight to the client.',
      ),
    ].join(''),
    cta: { label: 'Open the job in HQ', href: link },
  })
  const text = renderEmailText([subject, '', ...rows.map((r) => `${r.label}: ${r.value}`), '', link])

  const clientEmail = ev.clientEmail?.trim()
  await sendAgreementEmail({
    to: await channelRecipients('hq-documents'),
    subject,
    html,
    text,
    replyTo: clientEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail) ? clientEmail : undefined,
    label: `paperwork-submitted:job:${ev.step}:${job.id.slice(0, 8)}`,
  })
}
