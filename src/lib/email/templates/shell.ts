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
 * accent (#0F7A93), cream page (#f6f4ef). Note the site's Archivo is NOT
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
const GOLD = '#0F7A93'
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
  /** Accent for the eyebrow, CTA and footer links. Defaults to SirReel gold;
   *  partner-facing mail passes the Utliiz turquoise (Wes 2026-09-06:
   *  "the turquoise that foreshadows Utliiz"). */
  accent?: string
  /** Co-branded masthead — THEIR mark, a rule, OURS — in place of the
   *  SirReel-only header. Partner mail wears it (Wes 2026-09-11: "the shared
   *  logo header like we have for production companies … something that
   *  communicates a partnership"), the same lockup the client account portal
   *  and the partner account page carry.
   *
   *  `logoUrl` must be an ABSOLUTE, PUBLIC, RASTER url — see
   *  `partnerLogoEmailUrl()`. No logo (or a vector-only one, which Gmail and
   *  Outlook refuse to render) falls back to their NAME set in the display
   *  weight, so the band still reads as theirs — and still reads with images
   *  blocked, which is how a first-contact mail usually arrives. */
  lockup?: { partnerName: string; logoUrl?: string | null }
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
export function calloutBox(html: string, accent: string = GOLD): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">
      <tr>
        <td style="border-left:3px solid ${accent};background:#faf7f2;padding:14px 16px;font-family:${FONT};font-size:14px;line-height:1.55;color:${BODY_TEXT};">${html}</td>
      </tr>
    </table>`
}

export function renderEmailShell(o: EmailShellOptions): string {
  const preheader = o.preheader ?? o.heading
  const accent = o.accent ?? GOLD
  // Dark ink reads on gold; on a saturated accent the label goes white.
  const ctaInk = o.accent && o.accent !== GOLD ? '#ffffff' : INK
  const logo = `${PUBLIC_SITE_URL}/sirreel-logo-white.png`
  // The S mark, balancing the footer opposite the address. Same host as
  // the header wordmark, so if one loads both do.
  const mark = `${PUBLIC_SITE_URL}/s-logo-white.png`
  // The ink-on-transparent wordmark, for the white lockup band.
  const darkLogo = `${PUBLIC_SITE_URL}/sirreel-logo.png`

  // ── Masthead ───────────────────────────────────────────────────────────
  // Two ways in: the SirReel wordmark centred on ink (every client mail), or
  // the partnership lockup on white (partner mail). Their mark can be any
  // format on any ground, and recolouring it white for the dark band turns a
  // PNG-with-a-background into a white block — so the lockup gets its own
  // white band and an accent rule beneath it, which is what anchors the top of
  // the card once the ink is gone. Same reasoning as the client account portal
  // masthead (CompanyPortalView).
  const lockup = o.lockup
    ? `
          <tr>
            <td style="background:#ffffff;border:1px solid ${HAIRLINE};border-bottom:0;border-radius:10px 10px 0 0;padding:20px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  ${/* Both outer cells claim half the row so the rule lands on the
                       page's centre line whatever the two marks measure — Wes
                       2026-09-04 on the client portal: "Center the vertical line
                       between word marks on the page." */ ''}
                  <td align="left" width="50%" style="width:50%;vertical-align:middle;">
                    ${
                      o.lockup.logoUrl
                        ? `<img src="${esc(o.lockup.logoUrl)}" alt="${esc(o.lockup.partnerName)}" height="36" style="display:block;height:36px;max-height:36px;width:auto;max-width:190px;border:0;">`
                        : `<span style="font-family:${FONT};font-size:21px;line-height:1.1;font-weight:800;letter-spacing:-0.01em;color:${INK};">${esc(o.lockup.partnerName)}</span>`
                    }
                  </td>
                  <td width="44" align="center" style="width:44px;vertical-align:middle;">
                    ${/* A hairline rule, not an "&" — Wes 2026-09-04, "use | instead of &". A
                         1px div rather than a bordered cell: Outlook collapses a 1px-wide td. */ ''}
                    <div style="width:1px;height:34px;background:#d6d1c4;font-size:1px;line-height:1px;margin:0 auto;">&#8203;</div>
                  </td>
                  <td align="right" width="50%" style="width:50%;vertical-align:middle;">
                    <img src="${darkLogo}" alt="SirReel Studio Services" width="132"
                         style="display:block;width:132px;max-width:132px;height:auto;border:0;margin-left:auto;">
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td height="3" style="height:3px;line-height:3px;font-size:0;background:${accent};border-left:1px solid ${HAIRLINE};border-right:1px solid ${HAIRLINE};">&#8203;</td>
          </tr>`
    : `
          <tr>
            <td align="center" style="background:${INK};border-radius:10px 10px 0 0;padding:22px 28px;text-align:center;">
              <img src="${logo}" alt="SirReel Studio Services" width="150"
                   style="display:block;width:150px;max-width:150px;height:auto;border:0;margin:0 auto;">
            </td>
          </tr>`

  const cta = o.cta
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px;">
        <tr>
          <td style="background:${accent};border-radius:6px;">
            <a href="${esc(o.cta.href)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:${ctaInk};text-decoration:none;">${esc(o.cta.label)}</a>
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

          <!-- header — the SirReel wordmark centred, or the partnership
               lockup (see the lockup option above). Centring is belt and braces on
               purpose: the align="center" ATTRIBUTE is what Outlook's Word
               engine actually honours, text-align covers the rest, and
               margin:0 auto centres the block-level img itself. Any one of
               the three alone leaves it left-aligned somewhere. -->
${lockup}

          <!-- card -->
          <tr>
            <td style="background:#ffffff;padding:30px 28px 26px;border-left:1px solid ${HAIRLINE};border-right:1px solid ${HAIRLINE};">
              ${
                o.eyebrow
                  ? `<div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${accent};margin:0 0 8px;">${esc(o.eyebrow)}</div>`
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
                      <a href="${PUBLIC_CONTACT.phoneHref}" style="color:${accent};text-decoration:none;">${esc(PUBLIC_CONTACT.phone)}</a>
                      &nbsp;·&nbsp;
                      <a href="${PUBLIC_CONTACT.emailHref}" style="color:${accent};text-decoration:none;">${esc(PUBLIC_CONTACT.email)}</a>
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
