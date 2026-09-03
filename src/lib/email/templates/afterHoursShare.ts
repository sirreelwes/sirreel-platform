/**
 * "Here's how to get in" — the email a driver or PA receives when the
 * production forwards them the run.
 *
 * The recipient is NOT a SirReel customer. They may never have heard of us.
 * They are being asked to drive to an address at 5am and open a container.
 * So the email says who we are in one clause, who sent them, what they are
 * doing, and hands over one link — and it does not attempt a relationship.
 *
 * Codes are not in this email either, for the same reason they are not in
 * the client's: a forwarded email is a permanent copy. The link is scoped
 * to the after-hours page alone (see AfterHoursShare) — a driver holding it
 * cannot see the client's quote, invoice, or paperwork.
 */

import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from './shell'
import {
  AFTER_HOURS_LOCATION,
  AFTER_HOURS_SUPPORT,
} from '@/lib/afterHours/instructions'

export interface AfterHoursShareEmailInput {
  /** Whatever the sender typed — may be a first name, may be "the PA". */
  recipientName?: string | null
  /** Who forwarded it. "Mitchka Saberi", or the company when unnamed. */
  senderName?: string | null
  projectName: string
  /** The /after-hours/[token] URL. */
  link: string
  /** Sender's own note to the driver. */
  message?: string | null
  /** Days until the link stops working — stated, so nobody is surprised. */
  expiresInDays: number
}

export interface BuiltShareEmail {
  subject: string
  html: string
  text: string
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildAfterHoursShareEmail(
  input: AfterHoursShareEmailInput,
): BuiltShareEmail {
  const who = (input.recipientName || '').trim()
  const greeting = who ? `${who} —` : 'Hi —'
  const sender = (input.senderName || '').trim()
  const project = (input.projectName || 'a production').trim()
  const message = (input.message || '').trim()

  const subject = `SirReel gate access · ${project}`

  const rows = [
    {
      label: 'Where',
      value: `${AFTER_HOURS_LOCATION.street}, ${AFTER_HOURS_LOCATION.cityStateZip}`,
    },
    { label: 'Entrance', value: AFTER_HOURS_LOCATION.gateName },
    { label: 'Any trouble', value: `${AFTER_HOURS_SUPPORT.phone}, 24 hours` },
  ]

  const messageBlock = message
    ? calloutBox(
        `<strong>${sender ? `${esc(sender)} says` : 'From the production'}</strong><br/>${esc(message)}`,
      )
    : ''

  const bodyHtml = [
    p(
      `${greeting} ${
        sender ? `${esc(sender)} has` : 'The production has'
      } sent you to SirReel Studio Services to pick up or drop off gear for ` +
        `<strong>${esc(project)}</strong> outside our staffed hours.`,
    ),
    detailTable(rows),
    messageBlock,
    p(
      `Everything you need is on the page below — the gate code, the storage-container ` +
        `code, and what to do once you&rsquo;re in. Open it on your phone when you get here.`,
    ),
    p(
      `If a code doesn&rsquo;t work or the gear isn&rsquo;t where it should be, call ` +
        `<strong>${AFTER_HOURS_SUPPORT.phone}</strong>. That line is answered around the clock.`,
    ),
  ].join('\n')

  const html = renderEmailShell({
    eyebrow: 'Gate access',
    heading: 'Getting into the SirReel lot',
    preheader: `Gate code and directions for ${project}`,
    bodyHtml,
    cta: { label: 'Open the instructions', href: input.link },
    footNote: `This link is just for this run and stops working in ${input.expiresInDays} days. Please don't post it anywhere.`,
  })

  const text = renderEmailText([
    `${greeting} ${sender || 'the production'} has sent you to SirReel Studio Services to pick up`,
    `or drop off gear for ${project} outside our staffed hours.`,
    ``,
    `Where: ${AFTER_HOURS_LOCATION.street}, ${AFTER_HOURS_LOCATION.cityStateZip}`,
    `Entrance: ${AFTER_HOURS_LOCATION.gateName}`,
    `Any trouble: ${AFTER_HOURS_SUPPORT.phone}, 24 hours`,
    ``,
    ...(message ? [`${sender ? `${sender} says` : 'From the production'}: ${message}`, ``] : []),
    `The gate code, the container code and what to do once you're in are here —`,
    `open it on your phone when you arrive:`,
    input.link,
    ``,
    `This link is just for this run and stops working in ${input.expiresInDays} days.`,
  ])

  return { subject, html, text }
}
