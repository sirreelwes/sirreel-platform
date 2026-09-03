/**
 * "The client is stuck on the card form" — record the attempt, and tell
 * someone while it is still happening.
 *
 * Wes, 2026-09-03: "it's something that is usually needed same day or next
 * day so it would need to notify immediately if multiple failed attempts."
 *
 * The failure this replaces is not a bug in the card step — it is silence.
 * A client fighting the form was invisible to HQ; the first the team heard
 * of it was the client asking for the old Cognito form, and by then the
 * rental was being held up. Three of the eleven card links sent in the 60
 * days to 2026-09-03 were never completed and nobody knew.
 *
 * ── When it fires ──────────────────────────────────────────────────
 *
 *   AUTH_DECLINED    → immediately, first occurrence. The bank refused the
 *                      $0 check; retyping cannot fix it, so there is nothing
 *                      to wait for. (SR-JOB-0260 sat with one of these for
 *                      two days reading "On file" to everyone.)
 *   anything else    → on the THIRD failure inside 20 minutes. One typo is
 *                      not news; three is someone who is not getting through.
 *
 * At most one alert per hour per client, however hard they keep trying — an
 * alert that arrives ten times is an alert nobody reads.
 *
 * FIRE AND FORGET. Callers must not await: the client is mid-form, and a
 * Resend outage must never become their problem.
 *
 * Nothing about the card is stored or sent. `detail` is the tokenizer's or
 * the gateway's own message, neither of which carries a number.
 */
import { prisma } from '@/lib/prisma'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { renderEmailShell, renderEmailText, detailTable, calloutBox } from '@/lib/email/templates/shell'

export type CardTroubleKind = 'CARD_INVALID' | 'SUBMIT_REJECTED' | 'AUTH_DECLINED'

const KIND_LABEL: Record<CardTroubleKind, string> = {
  CARD_INVALID: 'The card number is being refused as they type it',
  SUBMIT_REJECTED: 'Their submission was turned away',
  AUTH_DECLINED: 'Their bank declined the $0 verification',
}

/** Failures inside this window count toward the threshold. */
const WINDOW_MIN = 20
/** Repeat failures inside this window do not send a second email. */
const QUIET_MIN = 60
const THRESHOLD = 3

const HQ_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')

export function recordCardTrouble(input: {
  token: string
  kind: CardTroubleKind
  detail?: string | null
}): void {
  void run(input).catch((err) =>
    console.error('[card-trouble] threw (the client is unaffected):', err),
  )
}

async function run({ token, kind, detail }: { token: string; kind: CardTroubleKind; detail?: string | null }) {
  const request = await prisma.paperworkRequest.findUnique({
    where: { token },
    select: {
      id: true,
      sentTo: true,
      booking: {
        select: {
          bookingNumber: true,
          jobName: true,
          jobId: true,
          startDate: true,
          company: { select: { name: true } },
          person: { select: { firstName: true, lastName: true, email: true, phone: true } },
        },
      },
    },
  })
  if (!request?.booking) return

  const attempt = await prisma.portalCardAttempt.create({
    data: { paperworkRequestId: request.id, kind, detail: detail?.slice(0, 500) || null },
    select: { id: true, createdAt: true },
  })

  const now = attempt.createdAt
  const quietSince = new Date(now.getTime() - QUIET_MIN * 60_000)
  const alreadyTold = await prisma.portalCardAttempt.count({
    where: { paperworkRequestId: request.id, notifiedAt: { gte: quietSince } },
  })
  if (alreadyTold > 0) return

  if (kind !== 'AUTH_DECLINED') {
    const windowSince = new Date(now.getTime() - WINDOW_MIN * 60_000)
    const recent = await prisma.portalCardAttempt.count({
      where: { paperworkRequestId: request.id, createdAt: { gte: windowSince } },
    })
    if (recent < THRESHOLD) return
  }

  const b = request.booking
  const company = b.company?.name?.trim() || '—'
  const clientName = [b.person?.firstName, b.person?.lastName].filter(Boolean).join(' ') || request.sentTo || '—'
  const attempts = await prisma.portalCardAttempt.count({ where: { paperworkRequestId: request.id } })

  // Stamp BEFORE sending. A send that throws must not leave the hour open
  // for the next keystroke to try again.
  await prisma.portalCardAttempt.update({ where: { id: attempt.id }, data: { notifiedAt: new Date() } })

  const subject = `Client stuck on card authorization | ${company} | ${b.jobName}`
  const link = b.jobId ? `${HQ_APP_URL}/jobs/${b.jobId}` : `${HQ_APP_URL}/jobs`
  const pickup = b.startDate
    ? b.startDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    : '—'

  const rows = [
    { label: 'What happened', value: KIND_LABEL[kind] },
    ...(detail ? [{ label: 'Reported as', value: detail.slice(0, 200) }] : []),
    { label: 'Attempts', value: String(attempts) },
    { label: 'Job', value: b.jobName },
    { label: 'Company', value: company },
    { label: 'Client', value: clientName },
    ...(b.person?.phone ? [{ label: 'Phone', value: b.person.phone }] : []),
    { label: 'Picks up', value: pickup },
    { label: 'Booking', value: b.bookingNumber },
  ]

  const html = renderEmailShell({
    eyebrow: 'Portal · card authorization',
    heading: 'A client is not getting their card through',
    preheader: `${company} · ${b.jobName}`,
    bodyHtml: [
      detailTable(rows),
      calloutBox(
        kind === 'AUTH_DECLINED'
          ? 'Their bank refused the check, so trying the same card again will not help — they need to use a different one. Replying to this email goes straight to the client.'
          : 'They are in the form right now. Replying to this email goes straight to the client; if they already signed an authorization elsewhere, it can be keyed in from the company page in HQ.',
      ),
    ].join(''),
    cta: { label: 'Open the job in HQ', href: link },
  })
  const text = renderEmailText([subject, '', ...rows.map((r) => `${r.label}: ${r.value}`), '', link])

  const clientEmail = request.sentTo?.trim()
  const sent = await sendAgreementEmail({
    to: await channelRecipients('portal-card-trouble'),
    subject,
    html,
    text,
    replyTo: clientEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail) ? clientEmail : undefined,
    label: `card-trouble:${kind}:${token.slice(0, 8)}`,
  })
  // The quiet-hour stamp is written BEFORE the send, so a failure here costs
  // the desk this hour's alert. Say so in the log rather than losing it: the
  // whole point of this module is that someone finds out.
  if (!sent.ok) {
    console.error(
      `[card-trouble] alert NOT delivered for ${token.slice(0, 8)} (${kind}): ${sent.reason ?? 'unknown'}`,
    )
  }
}
