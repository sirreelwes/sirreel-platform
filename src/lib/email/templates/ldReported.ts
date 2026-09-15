/**
 * "L&D reported" — the billing desk's heads-up that the floor recorded loss
 * or damage on an order.
 *
 * Ana, 2026-09-15: *"When sales/warehouse reports L&D on an order, it'd be
 * great if I can get that sent to me in an email so I know what to look out
 * for ... Something automatic, that way everyone else can focus on their
 * work and they just need to hit the button to send."*
 *
 * The button is the one they already press — filing the check-in sheet, or
 * finishing a vehicle's return walk-around. Nobody composes anything.
 *
 * The email is a heads-up, not a bill. A short count is evidence, not a
 * verdict (missing gear turns up on the truck the next morning), so it says
 * so, and a re-count that finds the piece sends a "turned up" note rather
 * than leaving Ana holding a stale list.
 */

import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from './shell'

export interface LdMissingRow {
  description: string
  missing: number
  expectedQty: number
  actualQty: number
  note: string | null
  /** Per unit, from inventory. null = HQ holds no figure. */
  replacementCost: number | null
}

export interface LdDamageRow {
  unitName: string | null
  location: string
  damageType: string
  severity: string
  estimate: number | null
  notes: string | null
  /** DamageItem.disposition when the reporter already decided how it
   *  bills (an incident's Bill renter does); absent = PENDING triage. */
  disposition?: string | null
}

export interface LdReportedEmailInput {
  source: 'CHECK_IN' | 'VEHICLE_RETURN' | 'INCIDENT'
  /** Set with source INCIDENT. */
  incidentNumber?: string | null
  orderNumbers: string[]
  jobName: string | null
  companyName: string | null
  reportedBy: string | null
  at: Date
  missing: LdMissingRow[]
  turnedUp: Array<{ description: string; wasMissing: number; nowMissing: number }>
  damage: LdDamageRow[]
  orderLink: string
  billingLink: string
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

// Where the damage goes next depends on its disposition, and the email must
// not imply it is waiting somewhere it is not: the composer lists only
// SEND_TO_LD rows, BILL_NOW rides the next RENTAL invoice on its own, and
// return damage lands PENDING until someone triages it.
function damageRouting(damage: LdDamageRow[]): string[] {
  const d = (x: LdDamageRow) => x.disposition || 'PENDING'
  const out: string[] = []
  if (damage.some((x) => d(x) === 'PENDING')) {
    out.push('Vehicle damage shows under Bill L&D once its disposition on the order is set to Send to L&D.')
  }
  if (damage.some((x) => d(x) === 'SEND_TO_LD')) {
    out.push('Damage marked Send to L&D is listed under Bill L&D now.')
  }
  if (damage.some((x) => d(x) === 'BILL_NOW')) {
    out.push('Damage marked Bill now goes on the next rental invoice automatically.')
  }
  return out
}

const DISPOSITION_WORDS: Record<string, string> = {
  BILL_NOW: 'bill now, on the rental invoice',
  SEND_TO_LD: 'send to L&D',
}

const lower = (s: string) => s.toLowerCase().replace(/_/g, ' ')

function missingLine(m: LdMissingRow): string {
  const cost =
    m.replacementCost != null && m.replacementCost > 0
      ? ` — ${usd(m.replacementCost * m.missing)} to replace${m.missing > 1 ? ` (${usd(m.replacementCost)} each)` : ''}`
      : ' — no replacement cost on file'
  return `${m.missing} × ${m.description} (${m.actualQty} of ${m.expectedQty} came back)${cost}${m.note ? `. Note: ${m.note}` : ''}`
}

function damageLine(d: LdDamageRow): string {
  const where = d.unitName ? `${d.unitName}: ` : ''
  const est = d.estimate != null && d.estimate > 0 ? ` — ${usd(d.estimate)} repair estimate` : ''
  const route = d.disposition && DISPOSITION_WORDS[d.disposition] ? ` [${DISPOSITION_WORDS[d.disposition]}]` : ''
  return `${where}${lower(d.damageType)} (${lower(d.severity)}) at ${d.location}${est}${route}${d.notes ? `. Note: ${d.notes}` : ''}`
}

function turnedUpLine(t: LdReportedEmailInput['turnedUp'][number]): string {
  return t.nowMissing === 0
    ? `${t.description} — all accounted for now (was ${t.wasMissing} missing)`
    : `${t.description} — ${t.nowMissing} still missing (was ${t.wasMissing})`
}

function list(items: string[]): string {
  if (!items.length) return ''
  const lis = items
    .map((t) => `<li style="margin:0 0 8px;">${esc(t)}</li>`)
    .join('')
  return `<ul style="margin:0 0 18px;padding-left:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#3d392f;">${lis}</ul>`
}

export function buildLdReportedEmail(i: LdReportedEmailInput) {
  // An incident with no order yet is addressed by its own number.
  const noOrder = i.orderNumbers.length === 0
  const orderRef = i.orderNumbers.join(', ') || i.incidentNumber || 'an order'
  const linkNoun = noOrder && i.source === 'INCIDENT' ? 'incident' : 'order'
  const account = [i.jobName, i.companyName].filter(Boolean).join(' · ')
  const tail = `${orderRef}${account ? ` · ${account}` : ''}`

  const missingUnits = i.missing.reduce((n, m) => n + m.missing, 0)
  const onlyGoodNews = !i.missing.length && !i.damage.length && i.turnedUp.length > 0

  const what: string[] = []
  if (missingUnits) what.push(`${missingUnits} item${missingUnits === 1 ? '' : 's'} not returned`)
  if (i.damage.length) {
    const units = Array.from(new Set(i.damage.map((d) => d.unitName).filter(Boolean)))
    what.push(`new damage${units.length ? ` on ${units.join(', ')}` : ''}`)
  }
  const subject = onlyGoodNews
    ? `L&D update: missing gear turned up — ${tail}`
    : `L&D: ${what.join(' + ')} — ${tail}`

  const knownValue =
    i.missing.reduce((n, m) => n + (m.replacementCost && m.replacementCost > 0 ? m.replacementCost * m.missing : 0), 0) +
    i.damage.reduce((n, d) => n + (d.estimate && d.estimate > 0 ? d.estimate : 0), 0)
  const unpriced =
    i.missing.filter((m) => !(m.replacementCost && m.replacementCost > 0)).length +
    i.damage.filter((d) => !(d.estimate && d.estimate > 0)).length

  const surface =
    i.source === 'CHECK_IN'
      ? 'the check-in sheet'
      : i.source === 'INCIDENT'
        ? `incident ${i.incidentNumber ?? ''}`.trim()
        : 'a vehicle return'
  const intro = onlyGoodNews
    ? `${i.reportedBy || 'The warehouse'} re-counted the check-in for ${orderRef}, and gear that was missing has turned up.`
    : noOrder && i.source === 'INCIDENT'
      ? `${i.reportedBy || 'Someone'} recorded damage on ${surface}.`
      : `${i.reportedBy || 'The yard'} recorded loss or damage on ${surface} for ${orderRef}.`

  const rows: Array<{ label: string; value: string }> = []
  if (i.orderNumbers.length) rows.push({ label: i.orderNumbers.length > 1 ? 'Orders' : 'Order', value: i.orderNumbers.join(', ') })
  if (i.jobName) rows.push({ label: 'Job', value: i.jobName })
  if (i.companyName) rows.push({ label: 'Client', value: i.companyName })
  if (i.incidentNumber) rows.push({ label: 'Incident', value: i.incidentNumber })
  rows.push({ label: 'Recorded by', value: i.reportedBy || '—' })
  rows.push({ label: 'When', value: fmtWhen(i.at) })

  const valueNote = onlyGoodNews
    ? ''
    : calloutBox(
        [
          knownValue > 0 ? `<strong>${usd(knownValue)}</strong> at the figures HQ holds.` : '',
          unpriced ? `${unpriced} item${unpriced === 1 ? ' has' : 's have'} no price on file.` : '',
          'Nothing has been billed yet.',
          i.missing.length
            ? 'A short count can still turn up on the truck — bill it from <strong>Bill L&amp;D</strong> on the billing queue once it is settled.'
            : '',
          ...damageRouting(i.damage).map(esc),
        ].filter(Boolean).join(' '),
      )

  const bodyHtml = [
    p(esc(intro)),
    detailTable(rows),
    i.missing.length ? p('<strong>Not returned</strong>') + list(i.missing.map(missingLine)) : '',
    i.damage.length ? p('<strong>New damage</strong>') + list(i.damage.map(damageLine)) : '',
    i.turnedUp.length ? p('<strong>Turned up since the last count</strong>') + list(i.turnedUp.map(turnedUpLine)) : '',
    valueNote,
    p(`<a href="${esc(i.billingLink)}" style="color:#0F7A93;">Open the billing queue</a>`),
  ].join('')

  const html = renderEmailShell({
    heading: onlyGoodNews ? 'Missing gear turned up' : 'L&D reported',
    eyebrow: 'Billing',
    preheader: subject,
    bodyHtml,
    cta: { label: `Open the ${linkNoun}`, href: i.orderLink },
  })

  const text = renderEmailText([
    intro,
    '',
    ...rows.map((r) => `${r.label}: ${r.value}`),
    '',
    ...(i.missing.length ? ['NOT RETURNED', ...i.missing.map((m) => `- ${missingLine(m)}`), ''] : []),
    ...(i.damage.length ? ['NEW DAMAGE', ...i.damage.map((d) => `- ${damageLine(d)}`), ''] : []),
    ...(i.turnedUp.length ? ['TURNED UP SINCE THE LAST COUNT', ...i.turnedUp.map((t) => `- ${turnedUpLine(t)}`), ''] : []),
    onlyGoodNews
      ? ''
      : [
          knownValue > 0 ? `${usd(knownValue)} at the figures HQ holds.` : '',
          unpriced ? `${unpriced} item(s) with no price on file.` : '',
          'Nothing has been billed yet.',
          i.missing.length ? 'Bill it from Bill L&D on the billing queue once it is settled.' : '',
          ...damageRouting(i.damage),
        ].filter(Boolean).join(' '),
    '',
    `${linkNoun === 'order' ? 'Order' : 'Incident'}: ${i.orderLink}`,
    `Billing queue: ${i.billingLink}`,
  ].filter((l, idx, arr) => l !== '' || (idx > 0 && arr[idx - 1] !== '')))

  return { subject, html, text }
}
