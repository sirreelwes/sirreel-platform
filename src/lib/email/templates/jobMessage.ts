/**
 * A staff member's own words to a client, sent from the Job page.
 *
 * Wes 2026-09-09: "I hate having to go back to email in order to send."
 * So this is a composer, not a template engine — there is no templated
 * prose to edit around. Whatever the agent typed IS the email; this file
 * only puts it in the same branded shell every other client-facing send
 * uses, so a note from the Job page doesn't arrive looking like it came
 * from a different company than the quote did.
 *
 * The heading is the PROJECT, not the subject line. A card whose headline
 * repeats the subject the client can already see reads like a form letter,
 * and this email is the opposite of one.
 *
 * Signed with the agent's own name above the SirReel line — the client is
 * being written to by a person, and the reply is routed back to that
 * person (see agentReplyTo in lib/email/teamVisibility).
 */

import { renderEmailShell, renderEmailText, p } from './shell'
import { CLIENT_SIGNOFF } from '@/lib/email/signoff'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Typed text → paragraphs. A blank line starts a new paragraph; a single
 * newline inside one becomes a <br>, because people write addresses and
 * short lists that way and collapsing them would silently rewrite the
 * message the agent read back before sending.
 */
function paragraphs(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => p(esc(block).replace(/\n/g, '<br/>')))
    .join('')
}

export interface JobMessageEmailInput {
  /** The job/project name — the card's headline. */
  projectName: string
  /** Subject line, as the agent left it. Used for the inbox preview only. */
  subject: string
  /** Exactly what the agent typed. */
  body: string
  /** Sending agent's display name; falls back to the SirReel sign-off. */
  agentName?: string | null
}

export function buildJobMessageEmail(input: JobMessageEmailInput): { html: string; text: string } {
  const bodyText = (input.body || '').trim()
  const agent = (input.agentName || '').trim()
  const project = (input.projectName || '').trim() || 'Your SirReel booking'

  const signoff = agent ? `${agent}<br/>${CLIENT_SIGNOFF}` : CLIENT_SIGNOFF

  const html = renderEmailShell({
    heading: project,
    // The subject is what the client already sees in their list; the
    // preview line should add the first words of the message instead.
    preheader: bodyText.slice(0, 140) || input.subject,
    bodyHtml: `${paragraphs(bodyText)}${p(signoff)}`,
  })

  // The plain-text part signs with the AGENT only — renderEmailText's own
  // footer already carries the company line, and printing it twice three
  // lines apart reads like a template that lost track of itself.
  const text = renderEmailText(
    [project, '', bodyText, '', agent].filter(
      (line, i, all) => line !== undefined && !(line === '' && all[i - 1] === ''),
    ) as string[],
  )

  return { html, text }
}
