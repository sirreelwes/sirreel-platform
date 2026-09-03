/**
 * "After-hours pickup & drop-off" — the email an agent sends instead of
 * attaching the flyer PDF.
 *
 * THE CODES ARE NOT IN THIS EMAIL, and that is the entire point. A gate
 * code in an inbox is a gate code in every inbox that message is ever
 * forwarded to, for as long as the mailbox exists, with no way to take it
 * back when the gate is reprogrammed. The email carries the arrival facts
 * that are already public (where the lot is, when it's open, who to call)
 * plus a link into the client's own token-gated portal session, where the
 * codes render live and stop rendering the moment the job's release is
 * revoked.
 *
 * Recipient is a coordinator forwarding this to a driver at 11pm, so the
 * shape is: what you're getting, the one link, and the phone number — in
 * that order, above the fold, on a phone.
 */

import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from './shell'
import {
  AFTER_HOURS_LOCATION,
  AFTER_HOURS_SCHEDULE,
  AFTER_HOURS_SUPPORT,
} from '@/lib/afterHours/instructions'

export interface AfterHoursEmailInput {
  firstName?: string | null
  /** What the client calls the job — "Chad Powers", "Coven Academy PROMO". */
  projectName: string
  /** Portal after-hours page, token included. */
  link: string
  /** Optional per-job line from the agent, rendered as its own callout. */
  note?: string | null
  repName?: string | null
  repPhone?: string | null
  repEmail?: string | null
}

export interface BuiltAfterHoursEmail {
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

export function buildAfterHoursEmail(input: AfterHoursEmailInput): BuiltAfterHoursEmail {
  const name = (input.firstName || '').trim()
  const greeting = name ? `${name} —` : 'Hi —'
  const project = (input.projectName || 'your rental').trim()
  const note = (input.note || '').trim()

  const subject = `After-hours pickup & drop-off · ${project}`

  const rows = [
    {
      label: 'Where',
      value: `${AFTER_HOURS_LOCATION.street}, ${AFTER_HOURS_LOCATION.cityStateZip} — ${AFTER_HOURS_LOCATION.gateName}`,
    },
    {
      label: 'Yard hours',
      value: `${AFTER_HOURS_SCHEDULE.weekdays} · ${AFTER_HOURS_SCHEDULE.saturday}`,
    },
    { label: 'Any trouble', value: `${AFTER_HOURS_SUPPORT.phone}, 24 hours` },
  ]

  const noteBlock = note
    ? calloutBox(`<strong>For this job</strong><br/>${esc(note)}`)
    : ''

  const bodyHtml = [
    p(
      `${greeting} here is how to collect or return your gear for <strong>${esc(project)}</strong> ` +
        `outside our normal hours.`,
    ),
    detailTable(rows),
    noteBlock,
    p(
      `Your gate code, the storage-container code and the step-by-step are on the page ` +
        `below. They live there rather than in this email so they stay current — if a code ` +
        `is changed at the lot, the page changes with it and anything printed from an older ` +
        `email would send your driver to a keypad that no longer works.`,
    ),
    p(
      `The page is part of your project portal, so it opens on any device and you can send ` +
        `the link straight to whoever is driving.`,
    ),
  ].join('\n')

  const html = renderEmailShell({
    eyebrow: 'After-hours access',
    heading: 'Picking up or dropping off after hours',
    preheader: `Gate, container and instructions for ${project}`,
    bodyHtml,
    cta: { label: 'Open after-hours instructions', href: input.link },
    footNote:
      'This link is tied to your project. Please keep it to your production team and the driver making the run.',
  })

  const text = renderEmailText([
    `${greeting} here is how to collect or return your gear for ${project} outside our normal hours.`,
    ``,
    `Where: ${AFTER_HOURS_LOCATION.street}, ${AFTER_HOURS_LOCATION.cityStateZip} — ${AFTER_HOURS_LOCATION.gateName}`,
    `Yard hours: ${AFTER_HOURS_SCHEDULE.weekdays} · ${AFTER_HOURS_SCHEDULE.saturday}`,
    `Any trouble: ${AFTER_HOURS_SUPPORT.phone}, 24 hours`,
    ``,
    ...(note ? [`For this job: ${note}`, ``] : []),
    `Your gate code, the storage-container code and the step-by-step are on this page —`,
    `they live there rather than in this email so they stay current:`,
    input.link,
    ``,
    ...(input.repName
      ? [
          `— ${input.repName}${input.repPhone ? `, ${input.repPhone}` : ''}${
            input.repEmail ? ` · ${input.repEmail}` : ''
          }`,
        ]
      : []),
  ])

  return { subject, html, text }
}
