/**
 * "<driver> checked out <unit>" — the HQ email for a driver self
 * check-out on a blind pickup. Nobody from SirReel saw the truck leave;
 * this is how the yard and the agent find out it did, and what they
 * were left with (photos, mileage, licence state).
 */

import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from './shell'
import { positionLabel } from '@/lib/fleet/photoPositions'

export interface DriverSelfCheckoutEmailInput {
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
  fuelLevel: string | null
  photoCount: number
  positions: string[]
  damageNoted: boolean
  notes: string | null
  licenseUnchecked: boolean
  jobLink: string | null
  reportLink: string
}

const fmtWhen = (d: Date) =>
  d.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

export function buildDriverSelfCheckoutEmail(i: DriverSelfCheckoutEmailInput) {
  const unit = i.unitDescription ? `${i.unitName} (${i.unitDescription})` : i.unitName
  const subject = `${i.driverName} checked out ${i.unitName} — ${i.productionName}`
  const when = fmtWhen(i.at)
  const shots = i.positions.map(positionLabel).join(', ')

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Vehicle', value: unit + (i.licensePlate ? ` · ${i.licensePlate}` : '') },
    { label: 'Production', value: i.productionName + (i.companyName ? ` · ${i.companyName}` : '') },
    { label: 'Driver', value: [i.driverName, i.driverPhone, i.driverEmail].filter(Boolean).join(' · ') },
    { label: 'Checked out', value: `${when} (Pacific)` },
    { label: 'Mileage', value: i.mileage != null ? `${i.mileage.toLocaleString('en-US')} mi` : 'Not typed — see odometer photo' },
  ]
  if (i.fuelLevel) rows.push({ label: 'Fuel', value: i.fuelLevel })
  rows.push({ label: 'Photos', value: `${i.photoCount}${shots ? ` — ${shots}` : ''}` })

  const flags: string[] = []
  if (i.damageNoted) flags.push('<strong>The driver reported existing damage</strong> — close-ups are in the report.')
  if (i.licenseUnchecked) flags.push('<strong>Licence not yet checked.</strong> It is on file and unexpired, but nobody at SirReel has opened it. Please review it on the job page.')
  if (i.notes) flags.push(`Driver&rsquo;s note: ${escapeHtml(i.notes)}`)

  const bodyHtml = [
    p(`An unattended pickup just completed. The driver photographed the vehicle and checked it out from their driver page — nobody from SirReel was on site.`),
    detailTable(rows),
    flags.length ? calloutBox(flags.join('<br/><br/>')) : '',
    p(
      `The condition report with every photo is at <a href="${i.reportLink}">the check-out report</a>` +
        (i.jobLink ? `, and the driver row on <a href="${i.jobLink}">the job page</a> now reads Picked up.` : '.'),
    ),
  ].join('\n')

  const html = renderEmailShell({
    eyebrow: 'Driver self check-out',
    heading: `${i.unitName} is out with ${i.driverName}`,
    preheader: `${i.productionName} — unattended pickup, ${i.photoCount} photos`,
    bodyHtml,
    cta: { label: 'Open the check-out report', href: i.reportLink },
  })

  const text = renderEmailText([
    `An unattended pickup just completed. The driver photographed the vehicle and checked it out from their driver page.`,
    ``,
    ...rows.map((r) => `${r.label}: ${r.value.replace(/&rsquo;/g, "'")}`),
    ``,
    ...(i.damageNoted ? ['The driver reported existing damage — close-ups are in the report.'] : []),
    ...(i.licenseUnchecked ? ['Licence not yet checked: on file and unexpired, but nobody at SirReel has opened it.'] : []),
    ...(i.notes ? [`Driver's note: ${i.notes}`] : []),
    ``,
    `Check-out report: ${i.reportLink}`,
    ...(i.jobLink ? [`Job page: ${i.jobLink}`] : []),
  ])

  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
