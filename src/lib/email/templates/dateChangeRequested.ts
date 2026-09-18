/**
 * "The client wants to move the dates" — the note that reaches the desk.
 *
 * Goes to the rep (Cc the sales channel), never to the client, and rides
 * the job's own thread so the ask is filed in the Conversation alongside
 * everything else on that job (label `date-change-request`). Reply-To is
 * the person who asked, so answering them is one keystroke.
 *
 * It says plainly that nothing has moved. The whole point of the request
 * shape is that a client's words do not change a booking — a rep opens
 * "Change dates…", reads the cascade and decides.
 */
import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from '@/lib/email/templates/shell'
import { pretty, type DayString } from '@/lib/portal/dateChangeRules'

export interface DateChangeRequestedInput {
  jobName: string | null
  jobCode: string | null
  orderNumber: string
  companyName: string | null
  askedByName: string | null
  askedByEmail: string | null
  currentStart: DayString | null
  currentEnd: DayString | null
  requestedStart: DayString | null
  requestedEnd: DayString | null
  note: string | null
  orderUrl: string
}

function changeLines(i: DateChangeRequestedInput): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  rows.push({
    label: 'Pickup',
    value: i.requestedStart
      ? `${pretty(i.currentStart)} → <strong>${pretty(i.requestedStart)}</strong>`
      : `${pretty(i.currentStart)} (unchanged)`,
  })
  rows.push({
    label: 'Return',
    value: i.requestedEnd
      ? `${pretty(i.currentEnd)} → <strong>${pretty(i.requestedEnd)}</strong>`
      : `${pretty(i.currentEnd)} (unchanged)`,
  })
  if (i.companyName) rows.push({ label: 'Client', value: i.companyName })
  rows.push({ label: 'Order', value: i.orderNumber })
  return rows
}

export function buildDateChangeRequested(i: DateChangeRequestedInput): {
  subject: string
  html: string
  text: string
} {
  const who = i.askedByName || i.askedByEmail || 'Someone on the job'
  const what = i.requestedStart || i.requestedEnd ? 'asked to move the dates' : 'asked about the dates'
  const jobLabel = i.jobName || i.jobCode || i.orderNumber

  const body = [
    p(`<strong>${who}</strong> ${what} on ${jobLabel}, from their portal.`),
    detailTable(changeLines(i)),
    i.note ? calloutBox(`<em>“${escapeHtml(i.note)}”</em>`) : '',
    p(
      'Nothing has changed on the order. Open it and use <strong>Change dates…</strong> — ' +
        'it shows the new totals, any unit that is already spoken for on those days, and ' +
        'the lines carrying their own dates, before anything is written. Applying it there ' +
        'closes this request.',
    ),
  ]
    .filter(Boolean)
    .join('')

  const html = renderEmailShell({
    eyebrow: 'Date change requested',
    heading: `${who} wants to move the dates`,
    preheader: `${jobLabel} — ${i.requestedStart ? `pickup ${pretty(i.currentStart)} → ${pretty(i.requestedStart)}` : 'see their note'}`,
    bodyHtml: body,
    cta: { label: 'Open the order', href: i.orderUrl },
    footNote: 'Sent because a client raised this from their job portal. Nothing on the order has moved.',
  })

  const text = renderEmailText([
    `${who} ${what} on ${jobLabel}.`,
    '',
    `Pickup: ${pretty(i.currentStart)}${i.requestedStart ? ` -> ${pretty(i.requestedStart)}` : ' (unchanged)'}`,
    `Return: ${pretty(i.currentEnd)}${i.requestedEnd ? ` -> ${pretty(i.requestedEnd)}` : ' (unchanged)'}`,
    i.note ? `` : '',
    i.note ? `They said: "${i.note}"` : '',
    '',
    'Nothing has changed on the order. Open it and use "Change dates..." to review the',
    'cascade before applying. Applying it there closes this request.',
    '',
    i.orderUrl,
  ].filter((l) => l !== undefined) as string[])

  return { subject: `Date change requested — ${jobLabel}`, html, text }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
