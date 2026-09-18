/**
 * "Check-in report" — what the warehouse found when the order came back.
 *
 * Wes, 2026-09-18: *"We need to then send a report, or actually, Albert
 * sends a report, on missing items or 100% returned. We need to add that
 * button."*
 *
 * Note the "or": this email exists as much for the clean return as for the
 * bad one. HQ already had an automatic L&D heads-up (ldReported.ts) that
 * fires the moment a sheet counts gear short — but nothing at all went out
 * when everything came back, so "no email" meant both "all good" and
 * "nobody has counted it yet". The whole point of the button is that
 * somebody stood at the shelf, finished, and says so.
 *
 * So the two versions are the same document with a different headline, and
 * the clean one is not a stub: it names what came back, who counted it and
 * when, because that is the record somebody goes looking for in November
 * when a client says a case never arrived.
 *
 * It is a REPORT, not a bill. Replacement cost is printed where HQ holds
 * one so the desk knows the size of it, and the email says plainly that
 * nothing has been charged — a short count still turns up on the truck the
 * next morning (ldCandidates.ts).
 */

import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from './shell'

export interface CheckInReportLine {
  description: string
  expectedQty: number
  actualQty: number
  damagedQty: number
  note: string | null
  /** Per unit, from inventory. null = HQ holds no figure. */
  replacementCost: number | null
}

export interface CheckInReportEmailInput {
  orderNumber: string
  jobName: string | null
  companyName: string | null
  /** Roll-up of everyone who counted on the sheet. */
  countedBy: string | null
  /** Who pressed send. */
  sentBy: string | null
  filedAt: Date
  /** Every line the sheet counted, in the order it sits on the sheet. */
  lines: CheckInReportLine[]
  /** Lines nobody counted on this sheet — still out (a partial return). */
  stillOut: Array<{ description: string; expectedQty: number }>
  /** The supervisor's note on the sheet. */
  notes: string | null
  orderLink: string
  sheetLink: string
}

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtWhen = (d: Date) =>
  d.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function list(items: string[]): string {
  if (!items.length) return ''
  const lis = items.map((t) => `<li style="margin:0 0 8px;">${esc(t)}</li>`).join('')
  return `<ul style="margin:0 0 18px;padding-left:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#3d392f;">${lis}</ul>`
}

const missingOf = (l: CheckInReportLine) => Math.max(0, l.expectedQty - l.actualQty)

function missingLine(l: CheckInReportLine): string {
  const n = missingOf(l)
  const cost =
    l.replacementCost != null && l.replacementCost > 0
      ? ` — ${usd(l.replacementCost * n)} to replace${n > 1 ? ` (${usd(l.replacementCost)} each)` : ''}`
      : ' — no replacement cost on file'
  return `${n} × ${l.description} (${l.actualQty} of ${l.expectedQty} came back)${cost}${l.note ? `. Note: ${l.note}` : ''}`
}

function damagedLine(l: CheckInReportLine): string {
  const cost =
    l.replacementCost != null && l.replacementCost > 0
      ? ` — ${usd(l.replacementCost * l.damagedQty)} to replace${l.damagedQty > 1 ? ` (${usd(l.replacementCost)} each)` : ''}`
      : ' — no replacement cost on file'
  return `${l.damagedQty} × ${l.description} back damaged (of ${l.actualQty} returned)${cost}${l.note ? `. Note: ${l.note}` : ''}`
}

export function buildCheckInReportEmail(i: CheckInReportEmailInput) {
  const missing = i.lines.filter((l) => missingOf(l) > 0)
  const damaged = i.lines.filter((l) => l.damagedQty > 0)
  const missingUnits = missing.reduce((n, l) => n + missingOf(l), 0)
  const damagedUnits = damaged.reduce((n, l) => n + l.damagedQty, 0)
  const clean = missingUnits === 0 && damagedUnits === 0 && i.stillOut.length === 0

  const account = [i.jobName, i.companyName].filter(Boolean).join(' · ')
  const tail = `${i.orderNumber}${account ? ` · ${account}` : ''}`

  const trouble: string[] = []
  if (missingUnits) trouble.push(`${missingUnits} item${missingUnits === 1 ? '' : 's'} not returned`)
  if (damagedUnits) trouble.push(`${damagedUnits} back damaged`)
  if (i.stillOut.length) trouble.push(`${i.stillOut.length} line${i.stillOut.length === 1 ? '' : 's'} still out`)

  const subject = clean
    ? `Checked in — everything came back · ${tail}`
    : `Checked in — ${trouble.join(', ')} · ${tail}`

  const counted = i.lines.length
  const intro = clean
    ? `${i.countedBy || 'The warehouse'} counted this order back in and everything on the sheet came back — ${counted} line${counted === 1 ? '' : 's'}, nothing missing, nothing damaged.`
    : `${i.countedBy || 'The warehouse'} counted this order back in. ${trouble.join(', ')}.`

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Order', value: i.orderNumber },
  ]
  if (i.jobName) rows.push({ label: 'Job', value: i.jobName })
  if (i.companyName) rows.push({ label: 'Client', value: i.companyName })
  rows.push({ label: 'Counted by', value: i.countedBy || '—' })
  rows.push({ label: 'Checked in', value: fmtWhen(i.filedAt) })
  rows.push({ label: 'Lines counted', value: String(counted) })
  if (i.sentBy) rows.push({ label: 'Report sent by', value: i.sentBy })

  const knownValue =
    missing.reduce(
      (n, l) => n + (l.replacementCost && l.replacementCost > 0 ? l.replacementCost * missingOf(l) : 0),
      0,
    ) +
    damaged.reduce(
      (n, l) => n + (l.replacementCost && l.replacementCost > 0 ? l.replacementCost * l.damagedQty : 0),
      0,
    )
  const unpriced =
    missing.filter((l) => !(l.replacementCost && l.replacementCost > 0)).length +
    damaged.filter((l) => !(l.replacementCost && l.replacementCost > 0)).length

  const callout = clean
    ? 'Nothing outstanding on this order — the gear is back on the shelf.'
    : [
        knownValue > 0 ? `<strong>${usd(knownValue)}</strong> at the figures HQ holds.` : '',
        unpriced ? `${unpriced} item${unpriced === 1 ? ' has' : 's have'} no price on file.` : '',
        'Nothing has been billed.',
        missingUnits
          ? 'A short count still turns up on the truck — bill it from <strong>Bill L&amp;D</strong> on the billing queue once it is settled.'
          : '',
        i.stillOut.length
          ? 'The lines still out were not counted at all, so they are not missing — the check-in is unfinished.'
          : '',
      ].filter(Boolean).join(' ')

  const bodyHtml = [
    p(esc(intro)),
    detailTable(rows),
    missing.length ? p('<strong>Not returned</strong>') + list(missing.map(missingLine)) : '',
    damaged.length ? p('<strong>Came back damaged</strong>') + list(damaged.map(damagedLine)) : '',
    i.stillOut.length
      ? p('<strong>Still out — not counted on this sheet</strong>') +
        list(i.stillOut.map((l) => `${l.description} (${l.expectedQty})`))
      : '',
    i.notes ? p(`<strong>Note on the sheet</strong><br>${esc(i.notes)}`) : '',
    calloutBox(callout),
    p(`<a href="${esc(i.sheetLink)}" style="color:#0F7A93;">See the filed check-in sheet</a>`),
  ].join('')

  const html = renderEmailShell({
    heading: clean ? 'Everything came back' : 'Checked in — loss or damage',
    eyebrow: 'Warehouse',
    preheader: subject,
    bodyHtml,
    cta: { label: 'Open the order', href: i.orderLink },
  })

  const text = renderEmailText([
    intro,
    '',
    ...rows.map((r) => `${r.label}: ${r.value}`),
    '',
    ...(missing.length ? ['NOT RETURNED', ...missing.map((l) => `- ${missingLine(l)}`), ''] : []),
    ...(damaged.length ? ['CAME BACK DAMAGED', ...damaged.map((l) => `- ${damagedLine(l)}`), ''] : []),
    ...(i.stillOut.length
      ? ['STILL OUT — NOT COUNTED ON THIS SHEET', ...i.stillOut.map((l) => `- ${l.description} (${l.expectedQty})`), '']
      : []),
    ...(i.notes ? [`Note on the sheet: ${i.notes}`, ''] : []),
    callout.replace(/<[^>]+>/g, ''),
    '',
    `Order: ${i.orderLink}`,
    `Filed sheet: ${i.sheetLink}`,
  ])

  return { subject, html, text }
}
