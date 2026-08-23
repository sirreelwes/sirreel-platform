/**
 * "You're driving <unit> for <production>" — the email that starts the
 * driver workflow. Sent when a production client, sales agent, or
 * warehouse/fleet names a driver for a specific vehicle on a job.
 *
 * Deliberately short. The recipient is a working driver, usually on a
 * phone, often not a SirReel customer and with no idea who we are — so
 * the email answers "who, what, when, and what do you need from me"
 * and hands off to the page for everything else.
 *
 * The licence ask leads because it is the one thing that will stop them
 * taking the vehicle if it isn't done.
 */

import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from './shell'

export interface DriverAssignmentEmailInput {
  driverFirstName?: string | null
  /** e.g. "Cube 12" */
  unitName: string
  /** e.g. "SuperCube Truck" */
  unitDescription?: string | null
  productionName: string
  companyName?: string | null
  /** YYYY-MM-DD */
  pickupDate?: string | null
  jobLink: string
  needsLicense: boolean
}

export interface BuiltEmail {
  subject: string
  html: string
  text: string
}

function fmtDay(ymd?: string | null): string | null {
  if (!ymd) return null
  const d = new Date(`${ymd}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

export function buildDriverAssignmentEmail(input: DriverAssignmentEmailInput): BuiltEmail {
  const name = (input.driverFirstName || '').trim()
  const greeting = name ? `${name} —` : 'Hi —'
  const day = fmtDay(input.pickupDate)
  const unit = input.unitDescription
    ? `${input.unitName} (${input.unitDescription})`
    : input.unitName

  const subject = `You're driving ${input.unitName} for ${input.productionName}`

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Vehicle', value: unit },
    { label: 'Production', value: input.productionName },
  ]
  if (input.companyName) rows.push({ label: 'Company', value: input.companyName })
  if (day) rows.push({ label: 'Pickup', value: day })

  const licenseAsk = input.needsLicense
    ? calloutBox(
        `<strong>Before you can take the vehicle</strong><br/>` +
          `We need a photo of your driver&rsquo;s license — both sides. It takes about a minute ` +
          `from your phone on the page below. Without it we can&rsquo;t hand the keys over.`,
      )
    : ''

  const bodyHtml = [
    p(`${greeting} you&rsquo;ve been listed as the driver for a SirReel production vehicle.`),
    detailTable(rows),
    licenseAsk,
    p(
      `Your driver page has everything you need on the day — where to go, pickup and ` +
        `drop-off instructions, what&rsquo;s loaded on the vehicle, and how to reach someone ` +
        `if anything goes sideways. Keep the link; it stays current if plans change.`,
    ),
  ].join('\n')

  const html = renderEmailShell({
    eyebrow: 'Driver assignment',
    // LITERAL apostrophe, not &rsquo; — renderEmailShell esc()s heading,
    // eyebrow, preheader and cta.label, so an entity here is escaped a
    // second time and the reader sees "You&rsquo;re driving". Only
    // bodyHtml (p/calloutBox/detailTable content) takes markup.
    heading: `You’re driving ${input.unitName}`,
    preheader: input.needsLicense
      ? `Upload your license before pickup — ${input.productionName}`
      : `Your driver page for ${input.productionName}`,
    bodyHtml,
    cta: { label: input.needsLicense ? 'Upload license & see details' : 'Open your driver page', href: input.jobLink },
    footNote: 'This link is personal to you. Please don’t forward it.',
  })

  const text = renderEmailText([
    `${greeting} you've been listed as the driver for a SirReel production vehicle.`,
    ``,
    `Vehicle: ${unit}`,
    `Production: ${input.productionName}`,
    ...(input.companyName ? [`Company: ${input.companyName}`] : []),
    ...(day ? [`Pickup: ${day}`] : []),
    ``,
    ...(input.needsLicense
      ? [
          `BEFORE YOU CAN TAKE THE VEHICLE:`,
          `We need a photo of your driver's license, both sides. About a minute from your phone.`,
          ``,
        ]
      : []),
    `Your driver page has pickup and drop-off instructions, what's loaded on the vehicle,`,
    `and how to reach someone if anything goes sideways:`,
    input.jobLink,
    ``,
    `This link is personal to you. Please don't forward it.`,
  ])

  return { subject, html, text }
}
