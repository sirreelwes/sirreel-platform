/**
 * Email for the production-company (account) portal — three templates that
 * share one shell:
 *
 *   1. the INVITE staff send when they grant account access,
 *   2. the EVENT notice (job started / invoice paid / job closed),
 *   3. the SHARE an executive forwards to their own production teams.
 *
 * ── The share is not from us ───────────────────────────────────────────
 * (3) is the odd one and the one to be careful with. It leaves our domain
 * on a client's instruction, to recipients we have never verified, and it
 * says so in the body: the sender is named, and the reply goes to THEM,
 * not to a SirReel inbox. Anything else would make SirReel look like it
 * cold-mailed a stranger's coordinator — and would land their reply in the
 * wrong building.
 *
 * The share carries NO rates and NO invoice figures. An executive forwards
 * it to a dozen people and it goes on from there; a negotiated rate in a
 * forwarded mail is a rate card in the wild.
 */

import {
  renderEmailShell,
  renderEmailText,
  p,
  detailTable,
  calloutBox,
} from '@/lib/email/templates/shell'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── 1. Invite ──────────────────────────────────────────────────────────

export interface CompanyPortalInviteInput {
  firstName: string
  companyName: string
  portalUrl: string
  repName: string
  repEmail: string | null
  /** Rendered only when the account actually has one. */
  annualAgreementTitle?: string | null
}

export function renderCompanyPortalInvite(i: CompanyPortalInviteInput): {
  subject: string
  html: string
  text: string
} {
  const subject = `Your ${i.companyName} account portal at SirReel`

  const body = [
    p(`${esc(i.firstName)},`),
    p(
      `You now have account-level access to SirReel for <strong>${esc(i.companyName)}</strong> — a single page showing every show your teams have with us, who's leading each one, the invoices, and the agreements on file.`,
    ),
    i.annualAgreementTitle
      ? calloutBox(
          `Your annual agreement, <strong>${esc(i.annualAgreementTitle)}</strong>, runs every show your company books. Each job is confirmed with a one-page addendum that logs it under the annual, so nobody re-signs the full agreement per show.`,
        )
      : '',
    p(
      `Sign in with this email address; there's no password. You can also choose which updates you want — job starts, invoices paid, shows closing out — from the bottom of the page.`,
    ),
  ].join('')

  const html = renderEmailShell({
    heading: 'Your account portal',
    eyebrow: i.companyName,
    preheader: `Every ${i.companyName} show with SirReel, in one place.`,
    bodyHtml: body,
    cta: { label: 'Open your account portal', href: i.portalUrl },
    footNote: i.repEmail
      ? `Questions? ${esc(i.repName)} — ${esc(i.repEmail)}`
      : `Questions? Reply to this email.`,
  })

  const text = renderEmailText([
    `${i.firstName},`,
    '',
    `You now have account-level access to SirReel for ${i.companyName} — every show your teams have with us, the invoices, and the agreements on file.`,
    '',
    `Open your account portal: ${i.portalUrl}`,
    '',
    `Sign in with this email address; there's no password.`,
    i.repEmail ? `\nQuestions? ${i.repName} — ${i.repEmail}` : '',
  ])

  return { subject, html, text }
}

// ── 2. Event notice ────────────────────────────────────────────────────

export interface CompanyPortalNoticeInput {
  firstName: string
  companyName: string
  portalUrl: string
  headline: string
  eyebrow: string
  /** Label/value rows — kept short; this is a nudge, not a report. */
  rows: { label: string; value: string }[]
  bodyLine: string
  ctaLabel: string
  ctaHref: string
}

export function renderCompanyPortalNotice(i: CompanyPortalNoticeInput): {
  subject: string
  html: string
  text: string
} {
  const subject = `${i.headline} — ${i.companyName}`

  const html = renderEmailShell({
    heading: i.headline,
    eyebrow: i.eyebrow,
    preheader: i.bodyLine,
    bodyHtml: [
      p(`${esc(i.firstName)},`),
      p(esc(i.bodyLine)),
      detailTable(i.rows),
    ].join(''),
    cta: { label: i.ctaLabel, href: i.ctaHref },
    footNote: 'You can change or turn off these updates from your account portal.',
  })

  const text = renderEmailText([
    `${i.firstName},`,
    '',
    i.bodyLine,
    '',
    ...i.rows.map((r) => `${r.label}: ${r.value}`),
    '',
    `${i.ctaLabel}: ${i.ctaHref}`,
    '',
    'You can change or turn off these updates from your account portal.',
  ])

  return { subject, html, text }
}

/**
 * A weekly roll-up of several notices into one mail — the WEEKLY cadence.
 * Same shell; the difference is that the reader gets one interruption
 * instead of nine.
 */
export function renderCompanyPortalDigest(i: {
  firstName: string
  companyName: string
  portalUrl: string
  items: { headline: string; detail: string }[]
}): { subject: string; html: string; text: string } {
  const subject = `This week at SirReel — ${i.companyName}`

  const list = i.items
    .map(
      (it) =>
        `<tr><td style="padding:8px 0;border-top:1px solid #e2ddd0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#3d392f;"><strong>${esc(it.headline)}</strong><br><span style="color:#8a8272;">${esc(it.detail)}</span></td></tr>`,
    )
    .join('')

  const html = renderEmailShell({
    heading: 'This week at SirReel',
    eyebrow: i.companyName,
    preheader: `${i.items.length} update${i.items.length === 1 ? '' : 's'} across your shows.`,
    bodyHtml: [
      p(`${esc(i.firstName)},`),
      p(`Here's what moved on your account this week.`),
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">${list}</table>`,
    ].join(''),
    cta: { label: 'Open your account portal', href: i.portalUrl },
    footNote: 'You can change or turn off these updates from your account portal.',
  })

  const text = renderEmailText([
    `${i.firstName},`,
    '',
    `Here's what moved on your account this week.`,
    '',
    ...i.items.map((it) => `• ${it.headline} — ${it.detail}`),
    '',
    `Open your account portal: ${i.portalUrl}`,
  ])

  return { subject, html, text }
}

// ── 3. Share with the client's own production teams ────────────────────

export interface CompanyPortalShareInput {
  /** The executive doing the sharing. Named in the body — this is from them. */
  senderName: string
  senderEmail: string
  recipientName: string | null
  companyName: string
  message: string | null
  /** Terms lines — annual agreement, standing waiver, rep. NO rates. */
  termsRows: { label: string; value: string }[]
  services: { name: string; blurb: string; href: string }[]
  /** Absolute base, e.g. https://hq.sirreel.com */
  siteBase: string
}

export function renderCompanyPortalShare(i: CompanyPortalShareInput): {
  subject: string
  html: string
  text: string
} {
  const subject = `${i.senderName} shared your SirReel account details — ${i.companyName}`

  const serviceList = i.services
    .map(
      (s) =>
        `<tr><td style="padding:10px 0;border-top:1px solid #e2ddd0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#3d392f;"><a href="${esc(i.siteBase)}${esc(s.href)}" style="color:#0c0c0d;font-weight:700;text-decoration:none;">${esc(s.name)}</a><br><span style="color:#8a8272;">${esc(s.blurb)}</span></td></tr>`,
    )
    .join('')

  const body = [
    p(`${i.recipientName ? `${esc(i.recipientName)},` : 'Hi,'}`),
    p(
      `<strong>${esc(i.senderName)}</strong> at ${esc(i.companyName)} asked us to send you this — how the ${esc(i.companyName)} account works with SirReel, and what we can do for your team.`,
    ),
    i.message ? calloutBox(esc(i.message).replace(/\n/g, '<br>')) : '',
    i.termsRows.length
      ? `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8a8272;margin:0 0 8px;">Your account</div>${detailTable(i.termsRows)}`
      : '',
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8a8272;margin:14px 0 2px;">What we can do</div>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">${serviceList}</table>`,
    p(
      `To book anything here, or to ask a question, reply to ${esc(i.senderName)} or get in touch with us directly.`,
    ),
  ].join('')

  const html = renderEmailShell({
    heading: `${i.companyName} × SirReel`,
    eyebrow: 'Shared with you',
    preheader: `${i.senderName} shared how the ${i.companyName} account works with SirReel.`,
    bodyHtml: body,
    cta: { label: 'See the fleet', href: `${i.siteBase}/vehicles` },
    footNote: `Sent at the request of ${esc(i.senderName)} (${esc(i.senderEmail)}). Replies go to them.`,
  })

  const text = renderEmailText([
    i.recipientName ? `${i.recipientName},` : 'Hi,',
    '',
    `${i.senderName} at ${i.companyName} asked us to send you this — how the ${i.companyName} account works with SirReel, and what we can do for your team.`,
    ...(i.message ? ['', i.message] : []),
    ...(i.termsRows.length ? ['', 'YOUR ACCOUNT', ...i.termsRows.map((r) => `${r.label}: ${r.value}`)] : []),
    '',
    'WHAT WE CAN DO',
    ...i.services.map((s) => `• ${s.name} — ${s.blurb} (${i.siteBase}${s.href})`),
    '',
    `Sent at the request of ${i.senderName} (${i.senderEmail}). Replies go to them.`,
  ])

  return { subject, html, text }
}
