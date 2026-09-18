/**
 * "Loss & damage notice" — what we are telling the PRODUCTION did not come
 * back, and what replacing it would cost.
 *
 * Wes, 2026-09-18, on Ana working from Albert's returned-order report:
 * *"It should be cued up for her to first notify the production with those
 * replacement items if they're lost, and what that would cost, or to be
 * able to write in something about damage and the cost that that would
 * be."*
 *
 * Read the word FIRST. This is the step before the invoice, and it is a
 * different document on purpose:
 *
 *   - An invoice says "you owe this". A notice says "these pieces did not
 *     come back, here is what replacing them costs, tell us if they turn
 *     up." Leading with the bill turns a recoverable case of gear left in
 *     a production office into an argument about a charge.
 *   - Productions routinely find the case. HQ's own doctrine already says
 *     a short count is evidence and not a verdict (ldCandidates.ts) — this
 *     is that doctrine reaching the client instead of stopping at Ana.
 *   - A production can often replace an item themselves more cheaply than
 *     we can bill it. The notice gives them that choice while it is still
 *     a choice.
 *
 * So there is NO payment link, NO due date and NO invoice number in here,
 * and the copy says plainly that nothing has been charged yet. When the
 * conversation lands, the L&D invoice follows and inherits these exact
 * lines (see model LdNotice).
 *
 * Damage lines read the same way: what came back broken, and what the
 * repair or replacement runs. Ana can write in a line the sheet never
 * captured — a cracked lens nobody counted — with her own figure.
 */

import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from './shell'
import { supportLines } from '@/lib/support/lines'

export interface LdNoticeLine {
  description: string
  qty: number
  /** Per unit. 0 is legal and means "we are telling you, not charging you"
   *  — a line listed for the record while the figure is still unknown. */
  unitPrice: number
  /** What kind of loss this is, for the grouping headline only. */
  kind: 'MISSING' | 'DAMAGE'
  note: string | null
}

export interface LdNoticeEmailInput {
  orderNumber: string
  jobName: string | null
  companyName: string | null
  /** First name of the contact, for the greeting. */
  contactFirstName: string | null
  /** When the gear was counted back in — the fact the notice rests on. */
  checkedInAt: Date | null
  lines: LdNoticeLine[]
  /** Ana's covering note, in her words. Rendered above the table. */
  note: string | null
  /** Who it is from, so a reply has a name to use. */
  senderName: string | null
}

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const fmtDay = (d: Date) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).format(d)

function lineTable(lines: LdNoticeLine[]): string {
  const rows = lines
    .map((l) => {
      const amount = l.qty * l.unitPrice
      // A line with no figure says so rather than printing $0.00, which
      // reads as "free" and is the one thing it never means.
      const each = l.unitPrice > 0 ? usd(l.unitPrice) : 'to be confirmed'
      const total = l.unitPrice > 0 ? usd(amount) : '—'
      return `
      <tr>
        <td style="padding:10px 12px 10px 0;font-size:15px;line-height:1.45;color:#1B1B1A;border-top:1px solid #E5E2DB;vertical-align:top;">
          ${esc(l.description)}
          ${l.note ? `<div style="font-size:13px;color:#6B6862;margin-top:3px;">${esc(l.note)}</div>` : ''}
        </td>
        <td style="padding:10px 12px;font-size:15px;color:#1B1B1A;border-top:1px solid #E5E2DB;text-align:right;vertical-align:top;white-space:nowrap;">${l.qty}</td>
        <td style="padding:10px 12px;font-size:15px;color:#1B1B1A;border-top:1px solid #E5E2DB;text-align:right;vertical-align:top;white-space:nowrap;">${each}</td>
        <td style="padding:10px 0 10px 12px;font-size:15px;font-weight:700;color:#1B1B1A;border-top:1px solid #E5E2DB;text-align:right;vertical-align:top;white-space:nowrap;">${total}</td>
      </tr>`
    })
    .join('')

  const priced = lines.filter((l) => l.unitPrice > 0)
  const subtotal = priced.reduce((s, l) => s + l.qty * l.unitPrice, 0)
  const unpriced = lines.length - priced.length

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 6px;">
    <tr>
      <td style="padding:0 12px 8px 0;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6B6862;">Item</td>
      <td style="padding:0 12px 8px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6B6862;text-align:right;">Qty</td>
      <td style="padding:0 12px 8px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6B6862;text-align:right;">Each</td>
      <td style="padding:0 0 8px 12px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6B6862;text-align:right;">Amount</td>
    </tr>
    ${rows}
    <tr>
      <td colspan="3" style="padding:12px 12px 0 0;font-size:15px;font-weight:700;color:#1B1B1A;border-top:2px solid #1B1B1A;text-align:right;">Estimated total</td>
      <td style="padding:12px 0 0 12px;font-size:17px;font-weight:700;color:#1B1B1A;border-top:2px solid #1B1B1A;text-align:right;white-space:nowrap;">${usd(subtotal)}</td>
    </tr>
  </table>
  ${
    unpriced > 0
      ? `<p style="margin:6px 0 0;font-size:13px;color:#6B6862;">${unpriced} item${unpriced === 1 ? '' : 's'} above ${unpriced === 1 ? 'has' : 'have'} no figure yet and ${unpriced === 1 ? 'is' : 'are'} not in that total.</p>`
      : ''
  }`
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildLdNoticeEmail(input: LdNoticeEmailInput): {
  subject: string
  html: string
  text: string
} {
  const missing = input.lines.filter((l) => l.kind === 'MISSING')
  const damage = input.lines.filter((l) => l.kind === 'DAMAGE')
  const lines = input.lines
  const priced = lines.filter((l) => l.unitPrice > 0)
  const subtotal = priced.reduce((s, l) => s + l.qty * l.unitPrice, 0)

  // The headline names what actually happened, so the subject is useful in
  // a crowded inbox and honest in a list view.
  const what =
    missing.length && damage.length
      ? 'Missing and damaged items'
      : damage.length
      ? 'Damaged items'
      : 'Missing items'

  const jobLabel = input.jobName || input.orderNumber
  const subject = `${what} from ${jobLabel} — ${input.orderNumber}`

  const greeting = input.contactFirstName ? `Hi ${input.contactFirstName},` : 'Hi,'

  const opening = missing.length
    ? `We finished checking in the gear from <b>${esc(jobLabel)}</b>${
        input.checkedInAt ? ` on ${esc(fmtDay(input.checkedInAt))}` : ''
      }, and ${
        missing.length === 1 ? 'one item did' : 'some items did'
      } not come back with it.`
    : `We finished checking in the gear from <b>${esc(jobLabel)}</b>${
        input.checkedInAt ? ` on ${esc(fmtDay(input.checkedInAt))}` : ''
      }, and ${damage.length === 1 ? 'one item came' : 'some items came'} back damaged.`

  const bodyParts: string[] = [
    p(greeting),
    p(opening),
    p(
      'Below is what we are looking for and what it would cost to replace. ' +
        '<b>Nothing has been charged.</b> If any of it turns up on your end — it often does, ' +
        'in a truck or a production office — just let us know and we will take it off the list.',
    ),
    detailTable([
      { label: 'Order', value: input.orderNumber },
      ...(input.jobName ? [{ label: 'Production', value: input.jobName }] : []),
      ...(input.companyName ? [{ label: 'Company', value: input.companyName }] : []),
    ]),
  ]

  if (input.note?.trim()) {
    bodyParts.push(calloutBox(p(esc(input.note.trim()).replace(/\n/g, '<br/>'))))
  }

  bodyParts.push(lineTable(lines))

  bodyParts.push(
    p(
      'If you would rather source replacements yourself, that is completely fine — ' +
        'tell us and we will hold off. Otherwise we will follow up with an invoice for the ' +
        'items still outstanding.',
    ),
  )

  const support = supportLines()
  bodyParts.push(
    p(
      `Any questions, just reply to this email${
        input.senderName ? ` and it will come straight to ${esc(input.senderName)}` : ''
      }, or call us on ${esc(support.office)}.`,
    ),
  )

  const html = renderEmailShell({
    eyebrow: 'Loss & damage',
    heading: what,
    preheader: `${lines.length} item${lines.length === 1 ? '' : 's'} from ${jobLabel} — nothing has been charged.`,
    bodyHtml: bodyParts.join(''),
    footNote:
      'This is a notice, not an invoice. No payment is due and no card has been charged.',
  })

  const text = renderEmailText([
    greeting,
    '',
    opening.replace(/<[^>]+>/g, ''),
    '',
    'Nothing has been charged. If any of it turns up, let us know and we will take it off the list.',
    '',
    `Order: ${input.orderNumber}`,
    ...(input.jobName ? [`Production: ${input.jobName}`] : []),
    '',
    ...(input.note?.trim() ? [input.note.trim(), ''] : []),
    ...lines.map(
      (l) =>
        `${l.qty} x ${l.description} — ${
          l.unitPrice > 0 ? `${usd(l.unitPrice)} each (${usd(l.qty * l.unitPrice)})` : 'figure to be confirmed'
        }${l.note ? ` [${l.note}]` : ''}`,
    ),
    '',
    `Estimated total: ${usd(subtotal)}`,
    '',
    'If you would rather source replacements yourself, tell us and we will hold off.',
    'Otherwise we will follow up with an invoice for the items still outstanding.',
  ])

  return { subject, html, text }
}
