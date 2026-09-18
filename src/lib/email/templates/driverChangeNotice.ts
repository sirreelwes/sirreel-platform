/**
 * "Something about your pickup changed" — the email a named driver gets
 * when the vehicle under them is swapped, or when either end of the
 * handoff stops (or starts) being attended.
 *
 * NOT a second invite. The link is the one they already have — the same
 * token, still valid — so this email must never read as a fresh
 * assignment or they will wonder which of the two is real. It opens with
 * what changed and says the link is unchanged.
 *
 * Words come from driverNoticeRule.noticeLines, which the text message
 * also reads, so the two cannot describe one change differently.
 */

import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from './shell'
import { supportLines } from '@/lib/support/lines'
import {
  lockboxMoved,
  noticeLines,
  noticeSubject,
  type DriverChange,
  type DriverNoticeFacts,
} from '@/lib/drivers/driverNoticeRule'

export interface DriverChangeNoticeInput {
  driverFirstName?: string | null
  facts: DriverNoticeFacts
  changes: DriverChange[]
  /** Their EXISTING driver page. Not re-minted — see the header. */
  jobLink: string
  companyName?: string | null
}

function fmtDay(ymd?: string | null): string | null {
  if (!ymd) return null
  const d = new Date(`${ymd}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function buildDriverChangeNoticeEmail(input: DriverChangeNoticeInput): {
  subject: string
  html: string
  text: string
} {
  const f = input.facts
  const name = (input.driverFirstName || '').trim()
  const greeting = name ? `${name} —` : 'Hi —'
  const subject = noticeSubject(f, input.changes)
  const lines = noticeLines(f, input.changes)
  const day = fmtDay(f.pickupDate)
  const support = supportLines()

  const rows: Array<{ label: string; value: string }> = [{ label: 'Vehicle', value: f.unitName }]
  if (f.productionName) rows.push({ label: 'Production', value: f.productionName })
  if (input.companyName) rows.push({ label: 'Company', value: input.companyName })
  if (day) rows.push({ label: 'Pickup', value: day })
  rows.push({ label: 'Entrance', value: 'Gate 1 off Kewen Ave' })

  // The changed facts lead, in a box, because the rest of this email is
  // the same detail they already had and the eye slides past it.
  const changeBox = calloutBox(
    `<strong>What changed</strong><br/>${lines.map((l) => esc(l)).join('<br/><br/>')}`,
  )

  const bodyHtml = [
    p(`${greeting} there&rsquo;s a change to the SirReel vehicle you&rsquo;re driving.`),
    changeBox,
    detailTable(rows),
    p(
      `Your driver page is already up to date and the link below is the same one you were sent ` +
        `&mdash; nothing has been re-issued. Open it before you set off and it will show the ` +
        `current vehicle, the instructions and anything we still need from you.`,
    ),
    p(
      esc(
        `Questions, or stuck at the yard? Text AHA, our after-hours assistant, at ${support.aha} — any hour. ` +
          `The office line ${support.office} is answered weekdays 7:30am–5:30pm.`,
      ),
    ),
  ].join('\n')

  const html = renderEmailShell({
    eyebrow: 'Change to your pickup',
    // LITERAL apostrophes — renderEmailShell esc()s heading and eyebrow,
    // so an entity here is escaped twice. Same trap as driverAssignment.ts.
    heading: subject,
    preheader: lines[0] ?? subject,
    bodyHtml,
    cta: { label: 'Open your driver page', href: input.jobLink },
    footNote: 'This link is personal to you. Please don’t forward it.',
  })

  const text = renderEmailText([
    `${greeting} there's a change to the SirReel vehicle you're driving.`,
    ``,
    `WHAT CHANGED:`,
    ...lines.flatMap((l) => [l, ``]),
    `Vehicle: ${f.unitName}`,
    ...(f.productionName ? [`Production: ${f.productionName}`] : []),
    ...(input.companyName ? [`Company: ${input.companyName}`] : []),
    ...(day ? [`Pickup: ${day}`] : []),
    `Entrance: Gate 1 off Kewen Ave`,
    ``,
    `Your driver page is already up to date and this is the same link you were sent -`,
    `nothing has been re-issued:`,
    input.jobLink,
    ``,
    `Questions, or stuck at the yard? Text AHA, our after-hours assistant, at ${support.aha} - any hour.`,
    `The office line ${support.office} is answered weekdays 7:30am-5:30pm.`,
    ``,
    `This link is personal to you. Please don't forward it.`,
  ])

  return { subject, html, text }
}

/** Re-exported so a caller needs one import to decide and to render. */
export { lockboxMoved }
