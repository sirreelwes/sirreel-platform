/**
 * "Your card didn't go through" — the client-facing decline notice.
 *
 * Wes, 2026-09-18: "WE NEED AN email to go out to the client when their card
 * declines." The sending half (who, dedupe, the job thread) is
 * `src/lib/portal/cardDeclinedEmail.ts`; this is the words, pure and
 * testable, the same split as cardAuthRequest.ts / composeCardAuthEmail.ts.
 *
 * FOUR things it has to do, and `npm run test:card-ask` pins all four:
 *
 *   1. Say the bank did not approve it. Not "there was a problem" — a client
 *      who does not know it was their bank goes looking at us.
 *   2. Say NOTHING WAS CHARGED, and why there is a figure at all ($0). This
 *      is the sentence that stops the phone call: a decline notice with no
 *      reassurance reads as a failed payment.
 *   3. Ask for a different card, and say the rest of their paperwork is
 *      saved — or they redo a signature they never lost.
 *   4. NOT guess why. We do not know, their bank will not tell us, and
 *      "insufficient funds" guessed wrong at a production's accounting desk
 *      is its own phone call. Same rule as cardAskClientSentence(). For the
 *      same reason it does not tell them to call their bank: that is advice
 *      about a cause we have not established.
 */

import { renderEmailShell, renderEmailText, calloutBox, p } from '@/lib/email/templates/shell'

export interface CardDeclinedEmailInput {
  /** Client's first name; omitted → a plain "Hi,". */
  firstName?: string | null
  /** Production name, when the paperwork hangs off a job. */
  jobName?: string | null
  /** Last four of the refused card, when recorded — lets them tell it from
   *  another card in their wallet without us naming anything sensitive. */
  last4?: string | null
  /** The client's own portal link, back to the card form. */
  link: string
}

export interface CardDeclinedEmail {
  subject: string
  html: string
  text: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildCardDeclinedEmail(input: CardDeclinedEmailInput): CardDeclinedEmail {
  const first = (input.firstName || '').trim()
  const jobName = (input.jobName || '').trim()
  const last4 = (input.last4 || '').trim()

  const forJob = jobName ? ` for ${jobName}` : ''
  const which = last4 ? ` ending ${last4}` : ''

  const subject = jobName
    ? `Your card didn't go through — ${jobName}`
    : `Your card didn't go through`

  const greeting = first ? `Hi ${first},` : 'Hi,'
  const lede = `The card${which} you just added${forJob} was not approved by your bank, so we can't use it for the rental.`
  const reassure = `Nothing was charged. Adding a card only verifies it — the amount we check with is $0.`
  const ask = `Please add a different card when you get a minute. Everything else you filled in is saved, so it's just the card.`
  const alternatives = `If you'd rather pay another way, we also take ACH, Zelle and wire transfer — just reply and we'll send the details.`

  const html = renderEmailShell({
    eyebrow: 'Card authorization',
    heading: `Your card didn't go through`,
    preheader: `${which ? `The card${which}` : 'The card'} was not approved — nothing was charged.`,
    bodyHtml: [
      p(escapeHtml(greeting)),
      p(escapeHtml(lede)),
      calloutBox(`<strong>Nothing was charged.</strong> ${escapeHtml(reassure.replace('Nothing was charged. ', ''))}`),
      p(escapeHtml(ask)),
      p(escapeHtml(alternatives)),
    ].join(''),
    cta: { label: 'Add a different card →', href: input.link },
  })

  const text = renderEmailText([
    greeting,
    '',
    lede,
    '',
    reassure,
    '',
    ask,
    '',
    `Add a different card: ${input.link}`,
    '',
    alternatives,
    '',
    'Thanks,',
    'The SirReel Team',
  ])

  return { subject, html, text }
}
