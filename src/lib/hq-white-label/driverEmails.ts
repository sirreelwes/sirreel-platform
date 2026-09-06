/**
 * What a partner's driver receives from their employer's Utliiz workspace.
 * Wes 2026-09-06: "one pain point for companies like SirReel and KK is
 * driver communication." Three notes, all phone-first, all in the
 * PARTNER's name — the driver works for King Kong, not for us:
 *
 *   assignment  "You're on the Honeywagon Mon–Wed" + their page
 *   update      the call time / address changed
 *   reminder    the evening before day one
 *
 * Utliiz's own palette (ink, Utah red, the invoice turquoise family) with
 * the workspace's brand name as the headline; never SirReel. The accent arg
 * is kept on the type for callers but no longer paints a band — Wes
 * 2026-09-06 saw a dark-mode client turn one into salmon.
 */
import { HQ_PRODUCT } from './product'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fmt = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

export interface DriverMailArgs {
  brandName: string
  accent: string
  driverName: string | null
  unitName: string
  title: string
  startDate: string
  endDate: string
  callTime: string | null
  location: string | null
  notes: string | null
  driverUrl: string
}

const INK = '#0f2a30'
const RED = '#CC0000'
const TEAL = '#0F7A93'
const TEAL_DEEP = '#0B5C70'
const EDGE = '#8FC2CE'
const GROUND = '#F1F8F9'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

/**
 * The frame every driver note shares: Utliiz's own look — white card on
 * the pale aqua ground, ink type, one red button, the partner's name as
 * the headline under a red rule (never a coloured band: dark-mode mail
 * clients invert those into mud, which is what Wes saw). Pinned to
 * light mode so Apple Mail leaves the colours alone.
 */
function frame(brandName: string, subject: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="light"/><meta name="supported-color-schemes" content="light"/><title>${esc(subject)}</title>
<style>:root{color-scheme:light}body{margin:0;padding:0;background:${GROUND}}</style></head>
<body style="margin:0;padding:0;background:${GROUND};font-family:${FONT};" bgcolor="${GROUND}">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${GROUND}" style="background:${GROUND}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="max-width:560px;background:#ffffff;border:1px solid ${EDGE};border-radius:16px">
<tr><td style="padding:26px 28px 0">
  <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${TEAL_DEEP}">Your job</div>
  <div style="font-size:22px;font-weight:800;letter-spacing:-.01em;color:${INK};margin-top:6px">${esc(brandName)}</div>
  <div style="height:4px;width:44px;background:${RED};margin-top:12px"></div>
</td></tr>
<tr><td style="padding:22px 28px 26px">${bodyHtml}</td></tr>
<tr><td style="padding:0 28px 22px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
    <td style="font-size:12px;color:#6b8a91;border-top:1px solid #E4F1F4;padding-top:14px">Sent by ${esc(brandName)} on <span style="color:${INK};font-weight:800">utl<span style="color:${RED}">ii</span>z</span></td>
  </tr></table>
</td></tr>
</table>
</td></tr></table></body></html>`
}

function shell(a: DriverMailArgs, subject: string, lead: string, cta: string, extra?: string): { subject: string; html: string; text: string } {
  const range = a.startDate === a.endDate ? fmt(a.startDate) : `${fmt(a.startDate)} – ${fmt(a.endDate)}`
  const rows: [string, string][] = [
    ['Unit', a.unitName],
    ['Job', a.title],
    ['Dates', range],
    ['Call time', a.callTime ?? 'to be set'],
    ['Location', a.location ?? 'to be set'],
    ...(a.notes ? ([['Notes', a.notes]] as [string, string][]) : []),
  ]
  const body = `
  <p style="font-size:17px;line-height:1.5;color:${INK};margin:0 0 10px">Hi ${esc(a.driverName ?? 'there')},</p>
  <p style="font-size:16px;line-height:1.6;color:${INK};margin:0 0 18px">${lead}</p>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${GROUND}" style="background:${GROUND};border-radius:12px">
    ${rows.map(([k, v], i) => `<tr><td style="padding:${i === 0 ? '14px' : '9px'} 16px ${i === rows.length - 1 ? '14px' : '9px'};font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${TEAL};width:96px;vertical-align:top">${esc(k)}</td><td style="padding:${i === 0 ? '14px' : '9px'} 16px ${i === rows.length - 1 ? '14px' : '9px'} 0;font-size:16px;font-weight:${k === 'Call time' ? '800' : '500'};color:${INK};vertical-align:top">${esc(v)}</td></tr>`).join('')}
  </table>
  ${extra ? `<p style="font-size:15px;line-height:1.6;color:${INK};margin:18px 0 0">${extra}</p>` : ''}
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:22px auto 0"><tr><td align="center" bgcolor="${RED}" style="background:${RED};border-radius:999px"><a href="${a.driverUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:16px;font-weight:800;padding:14px 28px">${esc(cta)} &rarr;</a></td></tr></table>
  <p style="font-size:13px;line-height:1.6;color:#4b6b72;margin:18px 0 0">That page is yours for this job: the address with map buttons, the call time as it changes, and where you log your hours and meters. Keep the link.</p>`
  const html = frame(a.brandName, subject, body)
  const text = [
    `Hi ${a.driverName ?? 'there'},`, '', lead.replace(/<[^>]+>/g, ''), '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '',
    ...(extra ? [extra.replace(/<[^>]+>/g, ''), ''] : []),
    `${cta}: ${a.driverUrl}`, '',
    `That page is yours for this job: the address with map buttons, the call time as it changes, and where you log your hours and meters. Keep the link.`, '',
    `— ${a.brandName}`, `Sent on ${HQ_PRODUCT.name}`,
  ].join('\n')
  return { subject, html, text }
}

export function buildDriverAssignment(a: DriverMailArgs) {
  return shell(a, `You're on the ${a.unitName} — ${fmt(a.startDate)}`, `<strong>${esc(a.brandName)}</strong> put you on the <strong>${esc(a.unitName)}</strong> for <strong>${esc(a.title)}</strong>.`, 'Open your job page', `Press <strong>I have it</strong> on the page so the office knows you saw this.`)
}

export function buildDriverUpdate(a: DriverMailArgs, changed: string[]) {
  return shell(a, `Update — ${a.unitName}, ${fmt(a.startDate)}: ${changed.join(', ')}`, `The ${changed.join(' and ')} changed on your <strong>${esc(a.unitName)}</strong> job. Here's the current plan.`, 'Open your job page', `Press <strong>I have it</strong> again so the office knows the change reached you.`)
}

export function buildDriverReminder(a: DriverMailArgs) {
  return shell(a, `Tomorrow — ${a.unitName}, call ${a.callTime ?? 'TBD'}`, `Tomorrow you're on the <strong>${esc(a.unitName)}</strong>. Call time <strong>${esc(a.callTime ?? 'to be set')}</strong>.`, 'Open your job page', `On the page: <strong>Rolling</strong> when you leave the lot with the odometer, and <strong>Back on the lot</strong> at wrap. Your hours log from the same place.`)
}

/** Roster invite: the partner added a driver by email. */
export function buildDriverInvite(a: { brandName: string; accent: string; driverName: string | null; profileUrl: string }) {
  const subject = `${a.brandName} added you as a driver`
  const body = `
  <p style="font-size:17px;line-height:1.5;color:${INK};margin:0 0 10px">Hi ${esc(a.driverName ?? 'there')},</p>
  <p style="font-size:16px;line-height:1.6;color:${INK};margin:0 0 18px">${esc(a.brandName)} added you to their driver list. Fill in your name, phone and licence once, and every job they put you on comes to this email with its own page: address, call time, hours.</p>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:6px auto 0"><tr><td align="center" bgcolor="${RED}" style="background:${RED};border-radius:999px"><a href="${a.profileUrl}" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:16px;font-weight:800;padding:14px 28px">Fill in your details &rarr;</a></td></tr></table>`
  const html = frame(a.brandName, subject, body)
  const text = `Hi ${a.driverName ?? 'there'},\n\n${a.brandName} added you to their driver list. Fill in your name, phone and licence once, and every job they put you on comes to this email with its own page.\n\nFill in your details: ${a.profileUrl}\n\n— ${a.brandName}\nSent on ${HQ_PRODUCT.name}`
  return { subject, html, text }
}
