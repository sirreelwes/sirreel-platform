/**
 * "<driver> returned <unit>" — the HQ email for a driver self return on a
 * blind drop-off. Nobody from SirReel received the truck; this is how the
 * yard finds out it is back, what the driver read off the dash, and where
 * the side-by-side photos are before they do their own walk-around.
 */

import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from './shell'
import { positionLabel } from '@/lib/fleet/photoPositions'

export interface DriverSelfReturnEmailInput {
  driverName: string
  driverPhone: string | null
  driverEmail: string | null
  unitName: string
  unitDescription: string | null
  licensePlate: string | null
  productionName: string
  companyName: string | null
  at: Date
  mileage: number | null
  mileageOut: number | null
  milesDriven: number | null
  fuelLevel: string | null
  photoCount: number
  positions: string[]
  damageNoted: boolean
  notes: string | null
  jobLink: string | null
  returnScreenLink: string
  reportLink: string
}

const fmtWhen = (d: Date) =>
  d.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

const mi = (n: number) => `${n.toLocaleString('en-US')} mi`

export function buildDriverSelfReturnEmail(i: DriverSelfReturnEmailInput) {
  const unit = i.unitDescription ? `${i.unitName} (${i.unitDescription})` : i.unitName
  const subject = `${i.driverName} returned ${i.unitName} — ${i.productionName}`
  const when = fmtWhen(i.at)
  const shots = i.positions.map(positionLabel).join(', ')

  const mileageValue =
    i.mileage != null
      ? mi(i.mileage) +
        (i.mileageOut != null ? ` (out at ${mi(i.mileageOut)}` + (i.milesDriven != null ? `, ${mi(i.milesDriven)} driven)` : ')') : '')
      : 'Not typed — see odometer photo'

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Vehicle', value: unit + (i.licensePlate ? ` · ${i.licensePlate}` : '') },
    { label: 'Production', value: i.productionName + (i.companyName ? ` · ${i.companyName}` : '') },
    { label: 'Driver', value: [i.driverName, i.driverPhone, i.driverEmail].filter(Boolean).join(' · ') },
    { label: 'Dropped off', value: `${when} (Pacific)` },
    { label: 'Mileage', value: mileageValue },
  ]
  if (i.fuelLevel) rows.push({ label: 'Fuel', value: i.fuelLevel })
  rows.push({ label: 'Photos', value: `${i.photoCount}${shots ? ` — ${shots}` : ''}` })

  const flags: string[] = []
  if (i.damageNoted) flags.push('<strong>The driver reported new damage</strong> — close-ups are in the report. Compare against the check-out shots before you sign it in.')
  if (i.notes) flags.push(`Driver&rsquo;s note: ${escapeHtml(i.notes)}`)

  const bodyHtml = [
    p(`An unattended return just happened. The driver photographed the vehicle and filed the readings from their driver page — nobody from SirReel was there to receive it. <strong>The yard still needs to walk it around and check it in</strong>; the return screen starts from the driver&rsquo;s photos and numbers.`),
    detailTable(rows),
    flags.length ? calloutBox(flags.join('<br/><br/>')) : '',
    p(
      `Check it in on <a href="${i.returnScreenLink}">the return screen</a>. The side-by-side report with every photo is at <a href="${i.reportLink}">the condition report</a>` +
        (i.jobLink ? `, and the drivers panel on <a href="${i.jobLink}">the job page</a> shows the drop.` : '.'),
    ),
  ].join('\n')

  const html = renderEmailShell({
    eyebrow: 'Driver self return',
    heading: `${i.unitName} is back — dropped by ${i.driverName}`,
    preheader: `${i.productionName} — unattended return, ${i.photoCount} photos, needs check-in`,
    bodyHtml,
    cta: { label: 'Check it in', href: i.returnScreenLink },
  })

  const text = renderEmailText([
    `An unattended return just happened. The driver photographed the vehicle and filed the readings from their driver page. The yard still needs to walk it around and check it in.`,
    ``,
    ...rows.map((r) => `${r.label}: ${r.value.replace(/&rsquo;/g, "'")}`),
    ``,
    ...(i.damageNoted ? ['The driver reported new damage — close-ups are in the report.'] : []),
    ...(i.notes ? [`Driver's note: ${i.notes}`] : []),
    ``,
    `Return screen: ${i.returnScreenLink}`,
    `Condition report: ${i.reportLink}`,
    ...(i.jobLink ? [`Job page: ${i.jobLink}`] : []),
  ])

  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
