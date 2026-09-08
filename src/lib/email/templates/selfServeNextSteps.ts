/**
 * "Thanks for starting a job — here's how to get the paperwork going."
 *
 * Wes 2026-09-08, the morning after Labor Day: the first-business-hour
 * email to a client who set their own job up on the public rental
 * agreement page while nobody was here.
 *
 * The job it answers: someone did something genuinely helpful outside
 * business hours and got silence back. Chaotic Neutral LTD created
 * SR-JOB-0315 at 2:22pm on a closed holiday, signed the rental agreement
 * a minute later, and heard nothing — the only mail that moved went to an
 * internal inbox.
 *
 * Three things this has to do at once, in this order:
 *   1. Thank them, and be specific about what they already did. "Thanks
 *      for your submission" is what an autoresponder says; naming the
 *      signed agreement is what a person says.
 *   2. Be clear the reservation is still pending, WITHOUT reading as a
 *      rejection. Wes 2026-09-08 replaced a flat "Nothing is reserved yet"
 *      with the forward-looking promise — "we will confirm your reservation
 *      as soon as possible and send a formal quote". It is the same fact
 *      (a confirmation that has not happened) said as the next step rather
 *      than as a withdrawal. What it must never become is language that
 *      reads AS the confirmation: the portal's own notice
 *      (order.awaitingConfirmation) says the same thing, and an email that
 *      contradicts it is worse than no email.
 *   3. Give them the next paperwork step, which is REAL work that will
 *      not be wasted: insurance, drivers, and the agreement if unsigned.
 *
 * The checklist is built from live state, so it never asks for something
 * already on file and never thanks them for something they have not done.
 *
 * NOT WIRED TO SEND. Rendered for review only — see the note on
 * buildSelfServeNextStepsEmail. Wes reviews client-facing copy before the
 * first real send.
 */

import { renderEmailShell, renderEmailText, p, calloutBox } from '@/lib/email/templates/shell'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'

const ACCENT = '#0F7A93'

export interface SelfServeNextStepsInput {
  /** Client first name, for the greeting. */
  firstName: string | null
  companyName: string | null
  /** The show as they named it. */
  jobName: string
  /** Human date range they asked for, e.g. "Sep 12 – Sep 15". Null if none. */
  dateRange: string | null
  /** Days until the rental starts, for the urgency line. Null if undated. */
  daysUntilStart: number | null
  /** Live paperwork state — drives the checklist. */
  agreementSigned: boolean
  coiOnFile: boolean
  driversNamed: boolean
  /** Their portal, with a live magic link. */
  portalUrl: string
  /** The rep, when one is established for the client. Falls back to the house. */
  repName: string | null
  repEmail: string | null
  repPhone: string | null
}

interface Step {
  title: string
  body: string
  done: boolean
}

function stepsFor(i: SelfServeNextStepsInput): Step[] {
  return [
    {
      title: 'Rental agreement',
      done: i.agreementSigned,
      body: i.agreementSigned
        ? 'Signed.'
        : 'Read and sign it in your portal — it holds everything else up.',
    },
    {
      title: 'Certificate of insurance',
      done: i.coiOnFile,
      body: i.coiOnFile
        ? 'On file.'
        : 'Upload it in your portal, or forward this to your broker. The portal lists what it has to show — Auto Physical Damage is the line most often left off.',
    },
    {
      title: 'Who is driving',
      done: i.driversNamed,
      body: i.driversNamed
        ? 'Named — they have their pickup details.'
        : 'Add them in the portal and we will ask each for a photo of their license. We cannot release a vehicle without one.',
    },
  ]
}

function stepsHtml(steps: Step[]): string {
  return steps
    .map(
      (s) => `
      <tr>
        <td style="padding:12px 0;border-top:1px solid #e2ddd0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <div style="font-size:15px;font-weight:700;color:#0c0c0d;">
            ${s.done ? `<span style="color:#2f6f4f;">&#10003;</span> ` : ''}${esc(s.title)}
          </div>
          <div style="margin-top:3px;font-size:14px;line-height:1.55;color:${s.done ? '#8a8272' : '#3d392f'};">${esc(s.body)}</div>
        </td>
      </tr>`,
    )
    .join('')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Renders the email. Returns subject/html/text — it does NOT send. The
 * caller decides, and as of 2026-09-08 no caller does: this is staged for
 * Wes to read before it goes to anybody.
 */
export function buildSelfServeNextStepsEmail(i: SelfServeNextStepsInput) {
  const steps = stepsFor(i)
  const outstanding = steps.filter((s) => !s.done)
  const greeting = i.firstName ? `Hi ${i.firstName},` : 'Hi,'
  const show = i.companyName ? `${i.jobName} for ${i.companyName}` : i.jobName
  const rep = i.repName || 'your SirReel rep'

  const subject = `${i.jobName} — here's what's next`

  // The urgency line only appears when it is true. A rental three weeks
  // out does not need to be told it is close.
  const soon =
    i.daysUntilStart != null && i.daysUntilStart >= 0 && i.daysUntilStart <= 10
      ? i.daysUntilStart === 0
        ? ' Your dates start today.'
        : i.daysUntilStart === 1
          ? ' Your dates start tomorrow.'
          : ` Your dates are ${i.daysUntilStart} days out.`
      : ''

  const thanks = i.agreementSigned
    ? `You set it up and signed the rental agreement — that is the slow part done.`
    : `You set it up yourself, which saves us both time.`

  const bodyHtml = [
    p(esc(greeting)),
    p(`Thanks for starting <strong>${esc(show)}</strong>. ${esc(thanks)}${esc(soon)}`),
    p(`Our team will review it at the first opportunity.`),
    calloutBox(
      `<strong style="color:#0c0c0d;">We will confirm your reservation as soon as possible</strong> and send you a formal quote with your pricing. In the meantime the paperwork below carries straight through, so it is worth getting done now.`,
      ACCENT,
    ),
    `<div style="margin:22px 0 6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#8a8272;">Getting the paperwork going</div>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">${stepsHtml(steps)}</table>`,
    outstanding.length === 0
      ? p(`That is everything — the next thing you will get is the quote.`)
      : '',
  ].join('\n')

  const html = renderEmailShell({
    eyebrow: 'We have your job',
    heading: `Thanks for starting ${i.jobName}`,
    preheader: `We will review it at the first opportunity${i.dateRange ? ` (${i.dateRange})` : ''} — here's how to get the paperwork going.`,
    bodyHtml,
    cta: { label: 'Open your job portal', href: i.portalUrl },
    footNote:
      (i.repEmail
        ? `Questions, or need the dates held sooner? Reply to this email — it goes straight to ${esc(rep)}${i.repPhone ? `, or call ${esc(i.repPhone)}` : ''}. `
        : `Questions, or need the dates held sooner? Reply to this email, or call us at <a href="${PUBLIC_CONTACT.phoneHref}" style="color:${ACCENT};text-decoration:none;font-weight:600;">${PUBLIC_CONTACT.phone}</a>. `) +
      `We answer 24/7.`,
    accent: ACCENT,
  })

  const text = renderEmailText([
    greeting,
    '',
    `Thanks for starting ${show}. ${thanks}${soon}`,
    '',
    `Our team will review it at the first opportunity.`,
    '',
    `We will confirm your reservation as soon as possible and send you a formal quote with your pricing. In the meantime the paperwork below carries straight through, so it is worth getting done now.`,
    '',
    'GETTING THE PAPERWORK GOING',
    ...steps.map((s) => `  ${s.done ? '[done] ' : ''}${s.title} — ${s.body}`),
    '',
    `Your job portal: ${i.portalUrl}`,
    '',
    i.repEmail
      ? `Questions, or need the dates held sooner? Reply to this email — it goes straight to ${rep}${i.repPhone ? `, or call ${i.repPhone}` : ''}. We answer 24/7.`
      : `Questions, or need the dates held sooner? Reply to this email, or call ${PUBLIC_CONTACT.phone}. We answer 24/7.`,
  ])

  return { subject, html, text }
}
