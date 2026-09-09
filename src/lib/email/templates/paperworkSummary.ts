/**
 * "Where your paperwork stands" — the client-facing paperwork summary.
 *
 * Wes 2026-09-09: "we need a send paperwork summary to client. Basically
 * it should list what we have and what we need still… show status of each
 * and let them click in to fix."
 *
 * Two lists, in this order, and the order is the point: what is still
 * owed comes first with a link on every row, and what is already done
 * comes second so the client sees their own work counted rather than a
 * page of demands. Rows the client cannot act on (a certificate in our
 * review queue, an agreement that follows quote approval) sit in a
 * closing line, not in either list — chasing someone for our own next
 * move is how these emails get ignored.
 *
 * Rendered through the shared branded shell (templates/shell.ts) rather
 * than hand-rolled HTML — see the note there about the eleven templates
 * that drifted.
 */

import { renderEmailShell, renderEmailText, p } from './shell'

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const INK = '#0c0c0d'
const BODY_TEXT = '#3d392f'
const MUTED = '#8a8272'
const HAIRLINE = '#e2ddd0'
const ACCENT = '#0F7A93'
const GOOD = '#3f7a52'

export interface PaperworkSummaryRow {
  label: string
  state: 'done' | 'waiting' | 'needed'
  status: string
  detail: string
  /** Absolute URL the client clicks to deal with this row. Null on a
   *  `done`/`waiting` row, and null on EVERY row in a preview — the
   *  magic link is minted at send time, so the preview shows the rows
   *  without live buttons rather than dead ones. */
  href: string | null
}

export interface PaperworkSummaryEmailInput {
  firstName: string | null
  jobName: string
  rows: PaperworkSummaryRow[]
  /** Portal home for the CTA. Null in preview. */
  portalLink: string | null
  agentFirstName?: string | null
  agentPhone?: string | null
  /** Optional line the rep typed in the review modal, above the lists. */
  personalNote?: string | null
  /** "Write my own email" — replaces the templated opener. The lists,
   *  the button and the sign-off are the shell and stay. */
  customBody?: string | null
}

export interface PaperworkSummaryEmail {
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

function proseHtml(note: string): string {
  return note
    .split(/\n{2,}/)
    .map((para) => p(esc(para).replace(/\n/g, '<br />')))
    .join('')
}

/** Small caps heading over each list. */
function sectionLabel(text: string): string {
  return `<div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};margin:22px 0 10px;">${esc(text)}</div>`
}

/**
 * One paperwork row. A bordered block rather than a table row: the status
 * word, the sentence and the action have to stack on a phone, and a
 * three-column table would either wrap into nonsense or scroll.
 */
function row(r: PaperworkSummaryRow): string {
  const isDone = r.state === 'done'
  const statusColor = isDone ? GOOD : r.state === 'needed' ? ACCENT : MUTED
  const mark = isDone
    ? `<span style="color:${GOOD};font-weight:700;">&#10003;</span> `
    : ''
  const action = r.href
    ? `<div style="margin:9px 0 0;"><a href="${esc(r.href)}" style="font-family:${FONT};font-size:14px;font-weight:700;color:${ACCENT};text-decoration:none;">Take care of it &rarr;</a></div>`
    : ''
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 10px;border:1px solid ${HAIRLINE};border-radius:8px;">
      <tr>
        <td style="padding:14px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="font-family:${FONT};font-size:15px;font-weight:700;color:${INK};vertical-align:top;">${mark}${esc(r.label)}</td>
              <td style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${statusColor};text-align:right;vertical-align:top;padding-left:12px;white-space:nowrap;">${esc(r.status)}</td>
            </tr>
          </table>
          <div style="margin:6px 0 0;font-family:${FONT};font-size:14px;line-height:1.55;color:${BODY_TEXT};">${esc(r.detail)}</div>
          ${action}
        </td>
      </tr>
    </table>`
}

export function buildPaperworkSummaryEmail(
  input: PaperworkSummaryEmailInput,
): PaperworkSummaryEmail {
  const firstName = (input.firstName || '').trim() || 'there'
  const jobName = (input.jobName || '').trim() || 'your production'
  const needed = input.rows.filter((r) => r.state === 'needed')
  const done = input.rows.filter((r) => r.state === 'done')
  const waiting = input.rows.filter((r) => r.state === 'waiting')
  const allSet = needed.length === 0

  const heading = allSet ? `Your paperwork is all set` : `Paperwork for ${jobName}`
  const opener = input.customBody?.trim()
    ? null
    : allSet
      ? `Here's where the paperwork stands for <strong>${esc(jobName)}</strong> — everything we need is in. Nothing for you to do; this is just so you have it in writing.`
      : `Here's an update on the paperwork for <strong>${esc(jobName)}</strong> — what we have, and what we still need from you. Each item below links straight to the place you can take care of it.`

  const bodyHtml = [
    input.customBody?.trim() ? '' : p(`Hi ${esc(firstName)},`),
    input.customBody?.trim() ? proseHtml(input.customBody.trim()) : p(opener!),
    input.personalNote?.trim() ? proseHtml(input.personalNote.trim()) : '',
    needed.length > 0
      ? sectionLabel(needed.length === 1 ? 'Still needed from you' : `Still needed from you · ${needed.length}`) +
        needed.map(row).join('')
      : '',
    done.length > 0 ? sectionLabel('Already taken care of') + done.map(row).join('') : '',
    waiting.length > 0
      ? p(
          `<span style="color:${MUTED};">On our side: ${waiting
            .map((w) => `${esc(w.label.toLowerCase())} (${esc(w.status.toLowerCase())})`)
            .join(', ')}. We'll follow up on ${waiting.length === 1 ? 'it' : 'those'} — nothing needed from you.</span>`,
        )
      : '',
    p(
      `Questions on any of it — just reply to this email${
        input.agentFirstName ? ` and it goes straight to ${esc(input.agentFirstName)}` : ''
      }${input.agentPhone ? `, or call ${esc(input.agentPhone)}` : ''}.`,
    ),
  ]
    .filter(Boolean)
    .join('\n')

  const html = renderEmailShell({
    heading,
    eyebrow: 'Paperwork status',
    preheader: allSet
      ? `Everything we need for ${jobName} is in.`
      : `${needed.length} item${needed.length === 1 ? '' : 's'} still needed for ${jobName}.`,
    bodyHtml,
    cta: input.portalLink ? { label: 'Open your job page', href: input.portalLink } : undefined,
    footNote: input.portalLink
      ? undefined
      : '(The secure link to your job page is generated when this email is sent.)',
  })

  const textLines: string[] = []
  if (input.customBody?.trim()) {
    textLines.push(input.customBody.trim(), '')
  } else {
    textLines.push(`Hi ${firstName},`, '')
    textLines.push(
      allSet
        ? `Here's where the paperwork stands for ${jobName} — everything we need is in.`
        : `Here's an update on the paperwork for ${jobName} — what we have, and what we still need from you.`,
      '',
    )
  }
  if (input.personalNote?.trim()) textLines.push(input.personalNote.trim(), '')
  if (needed.length > 0) {
    textLines.push('STILL NEEDED FROM YOU', '')
    for (const r of needed) {
      textLines.push(`- ${r.label} — ${r.status}`, `  ${r.detail}`)
      if (r.href) textLines.push(`  ${r.href}`)
      textLines.push('')
    }
  }
  if (done.length > 0) {
    textLines.push('ALREADY TAKEN CARE OF', '')
    for (const r of done) textLines.push(`- ${r.label} — ${r.status}`, `  ${r.detail}`, '')
  }
  if (waiting.length > 0) {
    textLines.push(
      `On our side: ${waiting.map((w) => `${w.label.toLowerCase()} (${w.status.toLowerCase()})`).join(', ')}. Nothing needed from you.`,
      '',
    )
  }
  textLines.push(
    input.portalLink
      ? `Your job page: ${input.portalLink}`
      : '(The secure link to your job page is generated when this email is sent.)',
    '',
    `Questions on any of it — just reply to this email${
      input.agentFirstName ? ` and it goes straight to ${input.agentFirstName}` : ''
    }${input.agentPhone ? `, or call ${input.agentPhone}` : ''}.`,
  )

  return {
    subject: allSet
      ? `Paperwork complete — ${jobName}`
      : `Paperwork update for ${jobName} — ${needed.length} item${needed.length === 1 ? '' : 's'} outstanding`,
    html,
    text: renderEmailText(textLines),
  }
}
