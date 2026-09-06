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
 * Utliiz palette, the workspace's brand name and accent, never SirReel.
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

function shell(a: DriverMailArgs, subject: string, lead: string, cta: string, extra?: string): { subject: string; html: string; text: string } {
  const range = a.startDate === a.endDate ? fmt(a.startDate) : `${fmt(a.startDate)} – ${fmt(a.endDate)}`
  const rows = [
    ['Unit', a.unitName],
    ['Job', a.title],
    ['Dates', range],
    ['Call time', a.callTime ?? 'to be set'],
    ['Location', a.location ?? 'to be set'],
    ...(a.notes ? [['Notes', a.notes]] : []),
  ]
  const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F1F8F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F1F8F9"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #8FC2CE">
<tr><td style="background:${a.accent};padding:18px 24px;color:#fff;font-size:18px;font-weight:800">${esc(a.brandName)}</td></tr>
<tr><td style="padding:24px 24px 8px">
<p style="font-size:17px;color:#0f2a30;margin:0 0 10px">Hi ${esc(a.driverName ?? 'there')},</p>
<p style="font-size:16px;line-height:1.6;color:#0f2a30;margin:0 0 14px">${lead}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
${rows.map(([k, v]) => `<tr><td style="padding:8px 0;border-top:1px solid #E4F1F4;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0B5C70;width:110px;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;border-top:1px solid #E4F1F4;font-size:16px;color:#0f2a30;vertical-align:top">${esc(v)}</td></tr>`).join('')}
</table>
${extra ? `<p style="font-size:14px;line-height:1.6;color:#0f2a30;margin:14px 0 0">${extra}</p>` : ''}
</td></tr>
<tr><td align="center" style="padding:20px 24px 8px"><a href="${a.driverUrl}" style="display:inline-block;background:${a.accent};color:#fff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 28px;border-radius:999px">${esc(cta)} &rarr;</a></td></tr>
<tr><td style="padding:12px 24px 24px"><p style="font-size:13px;line-height:1.6;color:#4b6b72;margin:0">That page is yours for this job: the address with map buttons, the call time as it changes, and where you log your hours and meters. Keep the link.</p></td></tr>
<tr><td style="padding:0 24px 22px"><p style="font-size:12px;color:#7a9aa1;margin:0">${esc(a.brandName)} runs on ${HQ_PRODUCT.name}.</p></td></tr>
</table></td></tr></table></body></html>`
  const text = [
    `Hi ${a.driverName ?? 'there'},`, '', lead.replace(/<[^>]+>/g, ''), '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '',
    ...(extra ? [extra.replace(/<[^>]+>/g, ''), ''] : []),
    `${cta}: ${a.driverUrl}`, '',
    `That page is yours for this job: the address with map buttons, the call time as it changes, and where you log your hours and meters. Keep the link.`, '',
    `— ${a.brandName}`,
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
  const html = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#F1F8F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F1F8F9"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #8FC2CE">
<tr><td style="background:${a.accent};padding:18px 24px;color:#fff;font-size:18px;font-weight:800">${esc(a.brandName)}</td></tr>
<tr><td style="padding:24px"><p style="font-size:17px;color:#0f2a30;margin:0 0 10px">Hi ${esc(a.driverName ?? 'there')},</p>
<p style="font-size:16px;line-height:1.6;color:#0f2a30;margin:0 0 14px">${esc(a.brandName)} added you to their driver list. Fill in your name, phone and licence once, and every job they put you on comes to this email with its own page: address, call time, hours.</p>
<p style="margin:18px 0 0"><a href="${a.profileUrl}" style="display:inline-block;background:${a.accent};color:#fff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 28px;border-radius:999px">Fill in your details &rarr;</a></p>
<p style="font-size:12px;color:#7a9aa1;margin:22px 0 0">${esc(a.brandName)} runs on ${HQ_PRODUCT.name}.</p></td></tr></table></td></tr></table></body></html>`
  const text = `Hi ${a.driverName ?? 'there'},\n\n${a.brandName} added you to their driver list. Fill in your name, phone and licence once, and every job they put you on comes to this email with its own page.\n\nFill in your details: ${a.profileUrl}\n\n— ${a.brandName}`
  return { subject, html, text }
}
