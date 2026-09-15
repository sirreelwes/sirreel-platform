/**
 * "Our response to your redlines is in your job portal" — the short, polite
 * note that goes out automatically when we post a counter-proposal.
 *
 * Wes 2026-09-15: "We have reviewed your redlines and our response is in your
 * job portal." Maybe a "Let's iron out the details and get to the shoot!"
 * Very simple and polite.
 *
 * Deliberately says nothing about WHAT we decided. The portal carries the
 * PDF and "Why we landed here"; an inbox summary of accepted / countered /
 * kept is exactly the blunt version that explanation exists to soften.
 */

import { renderEmailShell, renderEmailText, p } from './shell'
import { CLIENT_SIGNOFF } from '@/lib/email/signoff'

export interface CounterNoticeInput {
  firstName: string | null
  projectName: string
  portalUrl: string
  senderName: string | null
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildCounterNoticeEmail(input: CounterNoticeInput): { subject: string; html: string; text: string } {
  const project = input.projectName.trim() || 'your production'
  const greeting = input.firstName?.trim() ? `Hi ${input.firstName.trim()},` : 'Hi there,'
  const sender = input.senderName?.trim() || ''
  const lead = `We've reviewed your redlines, and our response is in your job portal for ${project} — along with a short note on how we landed on each change.`
  const push = "Let's iron out the details and get to the shoot!"

  const subject = `Our response to your redlines · ${project}`
  const html = renderEmailShell({
    heading: project,
    preheader: "We've reviewed your redlines — our response is in your job portal.",
    bodyHtml: [
      p(esc(greeting)),
      p(esc(lead)),
      p(esc(push)),
      p(sender ? `${esc(sender)}<br/>${CLIENT_SIGNOFF}` : CLIENT_SIGNOFF),
    ].join(''),
    cta: { label: 'See our response', href: input.portalUrl },
  })
  const text = renderEmailText(
    [greeting, '', lead, '', push, '', `See our response: ${input.portalUrl}`, '', sender].filter(
      (line, i, all) => !(line === '' && all[i - 1] === ''),
    ),
  )
  return { subject, html, text }
}
