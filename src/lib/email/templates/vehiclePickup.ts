/**
 * "After Hours Instructions" for a VEHICLE pickup — the email Jose types by
 * hand at 9:46 PM the night before a Pass van goes out.
 *
 * Found in his sent mail 2026-09-10 ("Pass van pick up ID for tomorrow"):
 * the lot address, "Enter through Gate 1 the code is 6184#", the
 * press-slowly line, the drivers-license reminder, then Vehicle / License
 * Plate / Vehicle Lock Box Code, then two links to www.sirreel.com pages.
 * Every fact in it lives in HQ already — the gate code in SiteSetting, the
 * plate and lockbox code on the Asset — and every one of them was retyped
 * from memory. This template is that email, read from the records.
 *
 * Deliberate differences from the hand-typed version:
 *   - The two www.sirreel.com links (/vehiclemap, /lockbox) are GONE. They
 *     404 since the site cutover (src/lib/site/legacyRedirects.data.js —
 *     Wes's call, Aug 2026), so the email was sending drivers to dead
 *     pages. The address links to Google Maps instead.
 *   - One block per vehicle. A job with two vans gets two blocks, not one
 *     email per van or one email naming the wrong van.
 *
 * THE CODES ARE IN THIS EMAIL. That is what sales sends today and what
 * Wes asked for (2026-09-10: "an easy button for sales to send this
 * summary"). The container flow (afterHoursAccess.ts) chose a link
 * instead; this one mirrors the message as sent, so the client's driver
 * has the code in hand at the gate at 5am with no page to open.
 */

import { renderEmailShell, renderEmailText, p, calloutBox } from './shell'
import { AFTER_HOURS_LOCATION, AFTER_HOURS_SUPPORT } from '@/lib/afterHours/instructions'

export interface VehiclePickupVehicle {
  unitName: string
  /** Category name — "Passenger Van (12)", "Cube Truck". */
  category: string | null
  licensePlate: string | null
  /** Per-vehicle keypad / lockbox code (Asset.accessCode). */
  lockboxCode: string | null
  /** Rental window, pre-formatted by the caller ("Sep 11 – Sep 12"). */
  window: string | null
}

export interface VehiclePickupEmailInput {
  firstName?: string | null
  /** What the client calls the job. */
  projectName: string
  gateCode: string
  vehicles: VehiclePickupVehicle[]
  /** Optional per-send line from the agent, rendered as its own callout. */
  note?: string | null
  repName?: string | null
  repPhone?: string | null
  repEmail?: string | null
}

export interface BuiltVehiclePickupEmail {
  subject: string
  html: string
  text: string
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** "Pass #9" · "Pass #9 and Cube 27" · "Pass #9, Cube 27 and Cube 28". */
export function vehicleListPhrase(names: string[]): string {
  if (names.length === 0) return 'your vehicle'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function vehicleBlockHtml(v: VehiclePickupVehicle): string {
  // No plate on file → no plate row. A "License plate: —" line reads as
  // "this van has no plate" to a driver hunting for it on a dark lot;
  // the panel flags the gap to the agent instead (2026-09-10: zero of 81
  // active units carried a plate — the field exists, nobody has typed
  // them in yet).
  const rows: Array<[string, string, boolean]> = [
    ['Vehicle', v.category ? `${v.unitName} · ${v.category}` : v.unitName, false],
    ...(v.licensePlate ? [['License plate', v.licensePlate, true] as [string, string, boolean]] : []),
    ['Vehicle lock box code', v.lockboxCode || '—', true],
  ]
  if (v.window) rows.push(['On the books', v.window, false])
  const body = rows
    .map(
      ([label, value, mono]) => `
      <tr>
        <td style="padding:6px 14px 6px 0;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#8a8272;vertical-align:top;white-space:nowrap;">${esc(label)}</td>
        <td style="padding:6px 0;font-family:${mono ? "SFMono-Regular,Menlo,Consolas,monospace" : FONT};font-size:${mono ? 17 : 15}px;font-weight:${mono ? 700 : 400};line-height:1.5;color:#3d392f;vertical-align:top;">${esc(value)}</td>
      </tr>`,
    )
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 14px;border:1px solid #e2ddd0;border-radius:8px;padding:8px 14px;">${body}</table>`
}

export function buildVehiclePickupEmail(input: VehiclePickupEmailInput): BuiltVehiclePickupEmail {
  const name = (input.firstName || '').trim()
  const greeting = name ? `${name} —` : 'Hi —'
  const project = (input.projectName || 'your rental').trim()
  const note = (input.note || '').trim()
  const gate = input.gateCode.trim()
  const names = input.vehicles.map((v) => v.unitName)
  const which = vehicleListPhrase(names)
  const plural = input.vehicles.length > 1

  const subject = `After-hours pickup · ${which} · ${project}`

  const bodyHtml = [
    p(
      `${esc(greeting)} here is everything ${plural ? 'your drivers need' : 'your driver needs'} to pick up ` +
        `<strong>${esc(which)}</strong> for <strong>${esc(project)}</strong> outside our staffed hours.`,
    ),
    p(
      `<strong>${esc(AFTER_HOURS_LOCATION.entity)}</strong><br/>` +
        `<a href="${AFTER_HOURS_LOCATION.mapsUrl}" style="color:#0F7A93;">${esc(AFTER_HOURS_LOCATION.street)}<br/>${esc(AFTER_HOURS_LOCATION.cityStateZip)}</a>`,
    ),
    p(
      `Enter through <strong>${esc(AFTER_HOURS_LOCATION.gateName)}</strong> The gate code is ` +
        `<strong style="font-family:SFMono-Regular,Menlo,Consolas,monospace;font-size:17px;">${esc(gate)}</strong><br/>` +
        `<em>Press the numbers slowly and firmly. You may need to repeat the code a few times if the gate does not open initially.</em>`,
    ),
    p(
      `<strong>Please have your driver&rsquo;s license handy</strong> — you may be asked to present it when picking up, dropping off, or parking.`,
    ),
    ...input.vehicles.map(vehicleBlockHtml),
    note ? calloutBox(`<strong>For this pickup</strong><br/>${esc(note)}`, '#0F7A93') : '',
    p(
      `Any trouble at the gate or the lock box, call ${esc(AFTER_HOURS_SUPPORT.phone)} — it is answered 24 hours.`,
    ),
  ]
    .filter(Boolean)
    .join('\n')

  const html = renderEmailShell({
    eyebrow: 'After-hours instructions',
    heading: `Picking up ${which}`,
    preheader: `Gate code, plate and lock box code for ${which}`,
    bodyHtml,
    cta: { label: 'Open the lot in Maps', href: AFTER_HOURS_LOCATION.mapsUrl },
    footNote:
      'These codes open our lot and your vehicle. Please keep this message to your production team and the driver making the run.',
  })

  const text = renderEmailText([
    `${greeting} here is everything ${plural ? 'your drivers need' : 'your driver needs'} to pick up ${which} for ${project} outside our staffed hours.`,
    ``,
    `After Hours Instructions`,
    ``,
    AFTER_HOURS_LOCATION.entity,
    AFTER_HOURS_LOCATION.street,
    AFTER_HOURS_LOCATION.cityStateZip,
    AFTER_HOURS_LOCATION.mapsUrl,
    ``,
    `Enter through ${AFTER_HOURS_LOCATION.gateName} The code is: ${gate}`,
    `Press the numbers slowly and firmly. You may need to repeat the code a few times if the gate does not open initially.`,
    ``,
    `Please have your driver's license handy as you may be asked to present it when picking up, dropping off, or parking.`,
    ``,
    ...input.vehicles.flatMap((v) => [
      `Vehicle: ${v.unitName}${v.category ? ` (${v.category})` : ''}`,
      ...(v.licensePlate ? [`License Plate: ${v.licensePlate}`] : []),
      `Vehicle Lock Box Code: ${v.lockboxCode || '—'}`,
      ...(v.window ? [`On the books: ${v.window}`] : []),
      ``,
    ]),
    ...(note ? [`For this pickup: ${note}`, ``] : []),
    `Any trouble at the gate or the lock box, call ${AFTER_HOURS_SUPPORT.phone} — answered 24 hours.`,
    ``,
    ...(input.repName
      ? [
          `— ${input.repName}${input.repPhone ? `, ${input.repPhone}` : ''}${
            input.repEmail ? ` · ${input.repEmail}` : ''
          }`,
        ]
      : []),
  ])

  return { subject, html, text }
}
