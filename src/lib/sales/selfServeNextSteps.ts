/**
 * Composes the "here's what's next" email for a job the CLIENT set up
 * themselves — the one thing shared by the preview and the send, so what
 * a rep reads on screen is byte-for-byte what leaves.
 *
 * Wes 2026-09-08: "Always CC these emails to rentals@ and show me the
 * email before sending." Both requirements live here:
 *
 *   CC       — `withTeamCc`, the admin-managed 'sales-team-cc' channel
 *              (/admin/notifications), whose default IS the rentals@
 *              group. Never hardcoded: the same channel already copies
 *              the desk on quotes and quick replies, so one edit moves
 *              all of them and nobody has to remember this file exists.
 *   REVIEW   — nothing here sends. `composeSelfServeNextSteps` returns a
 *              draft; only the POST route dispatches it, and only behind
 *              the review modal's Send button.
 *
 * The paperwork checklist reads LIVE state at compose time, so a rep who
 * opens the preview after the client uploads their COI sees the updated
 * email rather than a stale one.
 */

import { prisma } from '@/lib/prisma'
import { withTeamCc } from '@/lib/email/teamVisibility'
import { buildSelfServeNextStepsEmail } from '@/lib/email/templates/selfServeNextSteps'
import { portalJobUrl } from '@/lib/portal/portalUrl'
import { deriveOrderWindow } from '@/lib/jobs/dateRange'

/** Stable per-order tag — how we know it already went out. */
export const SELF_SERVE_EMAIL_LABEL = 'self-serve-next-steps'
export const selfServeEmailLabel = (orderId: string) => `${SELF_SERVE_EMAIL_LABEL}:${orderId}`

const SIGNED_STATUSES = ['SIGNED_BASELINE', 'SIGNED_NEGOTIATED', 'SIGNED_OFFLINE'] as const

export interface SelfServeDraft {
  orderId: string
  orderNumber: string
  jobCode: string
  jobName: string
  to: string
  cc: string[]
  replyTo: string | null
  subject: string
  html: string
  text: string
  /** Already sent, with when — the modal warns instead of hiding the button. */
  alreadySentAt: string | null
}

export type ComposeResult =
  | { ok: true; draft: SelfServeDraft }
  | { ok: false; reason: string }

export async function composeSelfServeNextSteps(jobId: string): Promise<ComposeResult> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobCode: true,
      name: true,
      company: { select: { name: true, coiOnFile: true } },
      agent: { select: { name: true, email: true, phone: true } },
      jobContacts: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { person: { select: { firstName: true, email: true } } },
      },
      bookings: {
        select: {
          items: {
            select: {
              assignments: {
                select: {
                  driverAssignments: {
                    where: { status: { not: 'CANCELLED' } },
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
      },
      coiChecks: { select: { id: true }, take: 1 },
      orders: {
        // The unquoted order this email is about. A job with several
        // orders is not the self-serve shape, but take the earliest
        // unquoted one rather than guessing.
        where: { status: 'DRAFT', quoteSentAt: null },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
          id: true,
          orderNumber: true,
          startDate: true,
          endDate: true,
          portalSlug: true,
          repVisibleToClient: true,
          lineItems: { select: { pickupDate: true, returnDate: true } },
          booking: { select: { startDate: true, endDate: true, status: true } },
          signedAgreements: {
            where: { status: { in: [...SIGNED_STATUSES] } },
            select: { id: true },
            take: 1,
          },
          portalAccesses: {
            where: { revokedAt: null, magicLinkExpiresAt: { gt: new Date() } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { magicLinkToken: true },
          },
        },
      },
    },
  })
  if (!job) return { ok: false, reason: 'job not found' }

  const order = job.orders[0]
  if (!order) return { ok: false, reason: 'no unquoted order on this job — nothing to chase' }
  if (!order.portalSlug) return { ok: false, reason: 'this order has no portal yet' }

  const contact = job.jobContacts.find((c) => c.person.email?.includes('@'))
  if (!contact) return { ok: false, reason: 'no contact with an email address on this job' }

  // Same derived-first / header-fallback rule as clientCreatedJobs.ts —
  // a job nobody has quoted has no lines to derive from, and the header
  // is the only record of the days the client asked for.
  const derived = deriveOrderWindow({ ...order, job: { bookings: [] } })
  const start = derived.start ?? order.startDate
  const end = derived.end ?? order.endDate
  const fmt = (d: Date | null) =>
    d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : null
  const daysUntilStart = start
    ? Math.ceil((start.getTime() - Date.now()) / 86_400_000)
    : null

  const driversNamed = job.bookings.some((b) =>
    b.items.some((it) => it.assignments.some((a) => a.driverAssignments.length > 0)),
  )

  // A rep is named to the client only where one is actually established
  // for this order — the portal applies the same rule, and the two must
  // agree. An automatic assignment is not a relationship.
  const repEstablished = !!order.repVisibleToClient && !!job.agent?.email

  const token = order.portalAccesses[0]?.magicLinkToken
  const mail = buildSelfServeNextStepsEmail({
    firstName: contact.person.firstName || null,
    companyName: job.company?.name ?? null,
    jobName: job.name,
    dateRange: start ? `${fmt(start)}${end && +end !== +start ? ` – ${fmt(end)}` : ''}` : null,
    daysUntilStart,
    agreementSigned: order.signedAgreements.length > 0,
    coiOnFile: job.coiChecks.length > 0 || !!job.company?.coiOnFile,
    driversNamed,
    portalUrl: portalJobUrl(order.portalSlug, token),
    repName: repEstablished ? job.agent!.name : null,
    repEmail: repEstablished ? job.agent!.email : null,
    repPhone: repEstablished ? job.agent!.phone ?? null : null,
  })

  const to = contact.person.email!
  const cc = await withTeamCc([], to)

  const prior = await prisma.emailDelivery.findFirst({
    where: { label: selfServeEmailLabel(order.id) },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })

  return {
    ok: true,
    draft: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      jobCode: job.jobCode,
      jobName: job.name,
      to,
      cc,
      // Replies reach the named rep when there is one, else the desk copy
      // on the CC line is the monitored destination.
      replyTo: repEstablished ? job.agent!.email : null,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      alreadySentAt: prior?.createdAt.toISOString() ?? null,
    },
  }
}
