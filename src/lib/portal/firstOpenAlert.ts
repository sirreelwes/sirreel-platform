/**
 * "They opened it." — one email to HQ the first time a client opens a
 * portal we sent them.
 *
 * Wes 2026-09-05: "let's actually send the first open alert to hq."
 *
 * First open only: the callers check the access counter BEFORE bumping it
 * and call this when it was zero, so a person who opens the same portal
 * forty times produces one line in the feed, not forty. Fire-and-forget
 * everywhere — a mail failure must never stand between a client and the
 * page they clicked.
 */

import { channelRecipients } from '@/lib/email/notificationChannels'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

export interface FirstOpenInput {
  kind: 'company' | 'job'
  personName: string
  personEmail: string
  /** The company (for a company portal) or the job (for a job portal). */
  subject: string
  /** Staff path to look at it. */
  href: string
  /** Extra line — order number, company on a job. */
  detail?: string | null
}

export async function alertFirstPortalOpen(i: FirstOpenInput): Promise<void> {
  const to = await channelRecipients('portal-opens')
  if (to.length === 0) return
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
  const what = i.kind === 'company' ? 'company portal' : 'job portal'
  const subject = `${i.personName || i.personEmail} opened the ${i.subject} ${what}`
  const line = `${i.personName || i.personEmail} (${i.personEmail}) opened the ${what} for ${i.subject}${i.detail ? ` — ${i.detail}` : ''} for the first time.`
  await sendAgreementEmail({
    to,
    subject,
    html: `<p>${line}</p><p><a href="${base}${i.href}">${base}${i.href}</a></p>`,
    text: `${line}\n\n${base}${i.href}`,
    label: `portal-first-open-${i.kind}`,
  })
}
