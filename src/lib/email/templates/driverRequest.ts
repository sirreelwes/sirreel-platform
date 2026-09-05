/**
 * "Who's driving <unit>?" — the ask to the PRODUCTION to name their
 * driver from their job page. Sent by a rep from the job's Drivers card
 * when nobody at SirReel has the driver's email (Wes 2026-09-05, Luis
 * Salgado: "we need to prompt Luis to input it").
 *
 * Short on purpose: one thing to do, one button that lands on the
 * drivers section of their portal page. It also says what happens next —
 * the driver gets their own link and uploads their own licence — so the
 * coordinator doesn't try to forward us a photo of it instead.
 */

import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from './shell'

export interface DriverRequestEmailInput {
  firstName: string
  productionName: string
  /** e.g. ["Cube 29 (SuperCube Truck) · Sep 6 – Sep 9"] */
  vehicles: string[]
  /** YYYY-MM-DD of the first pickup, for the subject urgency. */
  pickupDate: string | null
  unattendedPickup: boolean
  portalLink: string
  repName: string
  repPhone?: string | null
  repEmail?: string | null
}

const fmtDay = (ymd: string | null) => {
  if (!ymd) return null
  const d = new Date(`${ymd}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

export function buildDriverRequestEmail(i: DriverRequestEmailInput) {
  const day = fmtDay(i.pickupDate)
  const many = i.vehicles.length > 1
  const subject = `Who's driving for ${i.productionName}?${day ? ` (pickup ${day.split(',')[0]})` : ''}`
  const rows = i.vehicles.map((v, n) => ({ label: many ? `Vehicle ${n + 1}` : 'Vehicle', value: v }))
  if (day) rows.push({ label: 'Pickup', value: day })

  const bodyHtml = [
    p(`${i.firstName} &mdash; we have ${many ? 'your vehicles' : 'your vehicle'} reserved and need to know who&rsquo;s collecting ${many ? 'them' : 'it'}.`),
    detailTable(rows),
    p(
      `Add your driver&rsquo;s <strong>email address</strong> under <strong>Your drivers</strong> on your job page. ` +
        `That&rsquo;s all we need from you &mdash; the driver gets their own link with the pickup details, ` +
        `and they upload their own license from their phone. Please don&rsquo;t send us a photo of it; ` +
        `it has to come from them.`,
    ),
    i.unattendedPickup
      ? calloutBox(
          `<strong>This is an unattended pickup.</strong> Nobody from SirReel will be on site, so the ` +
            `driver&rsquo;s link is how they get the gate code, the lockbox code and the pickup instructions. ` +
            `Until a driver is named, none of that can go out.`,
        )
      : '',
    p(`Questions &mdash; ${i.repName}${i.repPhone ? `, ${i.repPhone}` : ''}${i.repEmail ? `, ${i.repEmail}` : ''}.`),
  ].join('\n')

  const html = renderEmailShell({
    eyebrow: 'Action needed',
    heading: `Who's driving?`,
    preheader: `Add your driver's email on your job page — ${i.productionName}`,
    bodyHtml,
    cta: { label: 'Name your driver', href: i.portalLink },
    footNote: 'This link is for you. Please don’t forward it to the driver — they get their own.',
  })

  const text = renderEmailText([
    `${i.firstName} — we have ${many ? 'your vehicles' : 'your vehicle'} reserved and need to know who's collecting ${many ? 'them' : 'it'}.`,
    ``,
    ...rows.map((r) => `${r.label}: ${r.value}`),
    ``,
    `Add your driver's EMAIL ADDRESS under "Your drivers" on your job page. The driver gets their own`,
    `link with the pickup details and uploads their own license from their phone — please don't send`,
    `us a photo of it; it has to come from them.`,
    ``,
    ...(i.unattendedPickup
      ? [
          `This is an unattended pickup: the driver's link is how they get the gate code, the lockbox code`,
          `and the pickup instructions. Until a driver is named, none of that can go out.`,
          ``,
        ]
      : []),
    `Name your driver: ${i.portalLink}`,
    ``,
    `Questions — ${i.repName}${i.repPhone ? `, ${i.repPhone}` : ''}${i.repEmail ? `, ${i.repEmail}` : ''}.`,
  ])
  return { subject, html, text }
}
