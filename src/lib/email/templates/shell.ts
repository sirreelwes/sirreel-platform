/**
 * Shared branded shell for SirReel client-facing email.
 *
 * WHY THIS EXISTS: the 11 templates in this directory each hand-rolled
 * their own HTML and stayed consistent only by copy-paste. Anything new
 * (or any restyle) drifted immediately, and the public forms had no
 * template at all. Render through here instead of writing a fresh
 * document, so the brand lives in one file.
 *
 * Brand follows the public site — near-black chrome (#0c0c0d), gold
 * accent (#c39a3f), cream page (#f6f4ef). Note the site's Archivo is NOT
 * used: email clients don't reliably load webfonts, so the stack falls
 * back to system sans and we match on color + layout instead of typeface.
 *
 * Email-client constraints this file already accounts for — keep them if
 * you edit it:
 *  - Tables for layout. Outlook's engine ignores flex/grid entirely.
 *  - Inline styles only. Gmail strips <style> blocks in many contexts.
 *  - A preheader div (hidden) controls the inbox preview line; without
 *    one, clients scrape the first visible text, which reads badly.
 *  - Absolute image URLs. Relative paths resolve nowhere in a mail client.
 *  - No background-image for anything load-bearing (blocked by default).
 */

import { PUBLIC_CONTACT, PUBLIC_SITE_URL } from '@/lib/site/publicNav'

const INK = '#0c0c0d'
const GOLD = '#c39a3f'
const CREAM = '#f6f4ef'
const BODY_TEXT = '#3d392f'
const MUTED = '#8a8272'
const HAIRLINE = '#e2ddd0'
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

export interface EmailShellOptions {
  /** Big heading inside the cream card. */
  heading: string
  /** Small gold kicker above the heading. */
  eyebrow?: string
  /** Inbox preview line. Falls back to the heading. */
  preheader?: string
  /** Body HTML — use `p()`, `detailTable()` and `calloutBox()` below. */
  bodyHtml: string
  cta?: { label: string; href: string }
  /** Small print under the card, above the footer. */
  footNote?: string
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Body paragraph. */
export function p(html: string): string {
  return `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.6;color:${BODY_TEXT};">${html}</p>`
}

/** Label/value rows — order summaries, contact details. Values are escaped. */
export function detailTable(rows: Array<{ label: string; value: string }>): string {
  if (rows.length === 0) return ''
  const body = rows
    .map(
      (r, i) => `
      <tr>
        <td style="padding:9px 14px 9px 0;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};vertical-align:top;white-space:nowrap;${i ? `border-top:1px solid ${HAIRLINE};` : ''}">${esc(r.label)}</td>
        <td style="padding:9px 0;font-family:${FONT};font-size:15px;line-height:1.5;color:${BODY_TEXT};vertical-align:top;${i ? `border-top:1px solid ${HAIRLINE};` : ''}">${esc(r.value)}</td>
      </tr>`,
    )
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">${body}</table>`
}

/** Gold-edged callout — reference numbers, "what happens next". */
export function calloutBox(html: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">
      <tr>
        <td style="border-left:3px solid ${GOLD};background:#faf7f2;padding:14px 16px;font-family:${FONT};font-size:14px;line-height:1.55;color:${BODY_TEXT};">${html}</td>
      </tr>
    </table>`
}

export function renderEmailShell(o: EmailShellOptions): string {
  const preheader = o.preheader ?? o.heading
  const logo = `${PUBLIC_SITE_URL}/sirreel-logo-white.png`
  // The S mark, balancing the footer opposite the address. Same host as
  // the header wordmark, so if one loads both do.
  const mark = `${PUBLIC_SITE_URL}/s-logo-white.png`

  const cta = o.cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px;">
        <tr>
          <td style="background:${GOLD};border-radius:6px;">
            <a href="${esc(o.cta.href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:${INK};text-decoration:none;">${esc(o.cta.label)}</a>
          </td>
        </tr>
      </table>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(o.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${esc(preheader)}</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CREAM};">
    <tr>
      <td align="center" style="padding:28px 16px 40px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;">

          <!-- header -->
          <tr>
            <td style="background:${INK};border-radius:10px 10px 0 0;padding:22px 28px;">
              <img src="${logo}" alt="SirReel Studio Services" width="150"
                   style="display:block;width:150px;max-width:150px;height:auto;border:0;">
            </td>
          </tr>

          <!-- card -->
          <tr>
            <td style="background:#ffffff;padding:30px 28px 26px;border-left:1px solid ${HAIRLINE};border-right:1px solid ${HAIRLINE};">
              ${
                o.eyebrow
                  ? `<div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${GOLD};margin:0 0 8px;">${esc(o.eyebrow)}</div>`
                  : ''
              }
              <h1 style="margin:0 0 16px;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:800;color:${INK};">${esc(o.heading)}</h1>
              ${o.bodyHtml}
              ${cta}
            </td>
          </tr>

          ${
            o.footNote
              ? `<tr>
            <td style="background:#ffffff;padding:0 28px 24px;border-left:1px solid ${HAIRLINE};border-right:1px solid ${HAIRLINE};">
              <div style="border-top:1px solid ${HAIRLINE};padding-top:14px;font-family:${FONT};font-size:12.5px;line-height:1.55;color:${MUTED};">${o.footNote}</div>
            </td>
          </tr>`
              : ''
          }

          <!-- footer — address left, S mark right (two cells of one row,
               not floats: Outlook ignores float and would stack them).
               The mark cell has a fixed width so the address column can
               never push it off the card, and the whole thing still reads
               correctly with images blocked: the mark is decorative, so
               its alt is empty rather than a stray "SirReel" under the
               address. -->
          <tr>
            <td style="background:${INK};border-radius:0 0 10px 10px;padding:20px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="vertical-align:middle;">
                    <div style="font-family:${FONT};font-size:13px;font-weight:700;color:#ffffff;margin:0 0 5px;">${esc(PUBLIC_CONTACT.entity)}</div>
                    <div style="font-family:${FONT};font-size:12.5px;line-height:1.6;color:#a8a294;">
                      ${esc(PUBLIC_CONTACT.address)}<br>
                      <a href="${PUBLIC_CONTACT.phoneHref}" style="color:${GOLD};text-decoration:none;">${esc(PUBLIC_CONTACT.phone)}</a>
                      &nbsp;·&nbsp;
                      <a href="${PUBLIC_CONTACT.emailHref}" style="color:${GOLD};text-decoration:none;">${esc(PUBLIC_CONTACT.email)}</a>
                    </div>
                  </td>
                  <td width="52" style="width:52px;vertical-align:middle;text-align:right;padding-left:16px;">
                    <img src="${mark}" alt="" width="44"
                         style="display:block;width:44px;max-width:44px;height:auto;border:0;margin-left:auto;">
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** Plain-text alternative. Never ship HTML-only — spam filters weight it. */
export function renderEmailText(lines: string[]): string {
  return [
    ...lines,
    '',
    '—',
    PUBLIC_CONTACT.entity,
    PUBLIC_CONTACT.address,
    `${PUBLIC_CONTACT.phone} · ${PUBLIC_CONTACT.email}`,
  ].join('\n')
}
