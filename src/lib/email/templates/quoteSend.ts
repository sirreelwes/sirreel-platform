/**
 * Quote-send email — the message that goes out with the Quote PDF
 * attached. Same dark-header / branded-lockup pattern as portalInvite.ts
 * so the agent's outbound communication reads as one consistent brand
 * voice from first-quote through portal-handoff.
 *
 * Asset references (real hosted files, NOT font stand-ins):
 *   - Header wordmark: /sirreel-logo-white.png — white-on-transparent
 *     PNG of the full lockup that sits on the dark header.
 *   - Footer mark:     /s-logo-white.png      — white-on-transparent
 *     S-mark for the compact footer line.
 *
 * Both files are served as static assets from /public via Vercel's CDN
 * (absolute URLs because email clients can't resolve relative paths).
 */

const HOST = 'https://hq.sirreel.com'
const ABSOLUTE_LOGO_URL_WHITE = `${HOST}/sirreel-logo-white.png`
const ABSOLUTE_S_MARK_URL_WHITE = `${HOST}/s-logo-white.png`
const SUPPLY_URL = `${HOST}/order/supplies`

const FOOTER_ADDRESS = '8500 Lankershim Blvd, Sun Valley, CA 91352'
const FOOTER_PHONE = '(888) 477-7335'
const GOLD = '#D4A547'
const DARK = '#0a0a0a'
const LINK_GRAY = '#9a9a9a'

export interface QuoteSendEmailInput {
  /** First name of the primary recipient. Falls back to "there". */
  firstName: string
  /** Order number, e.g. "SR-ORD-0042". */
  orderNumber: string
  /** Display name of the job, e.g. "Big Studio Q3". */
  jobName: string
  /** Agent sending the quote — appears in the sign-off. */
  agentName: string
  /** Agent's email — clickable mailto in the sign-off. */
  agentEmail?: string | null
  /** Fully-built portal URL including ?token=… — when set, renders the
   *  "Open Your Portal" CTA. The send route mints/reuses the magic-link
   *  token (ensureLiveJobMagicLink) and builds the URL; the composer
   *  only renders it. Pre-token bare-slug callers will break — that's
   *  intentional: a tokenless portal link dead-ends at the "session
   *  expired" page. */
  portalUrl?: string | null
  /** Optional free-text note from the agent. Plain text; will be
   *  escaped + newline-converted before insertion. */
  customMessage?: string | null
}

export interface QuoteSendEmail {
  subject: string
  html: string
  text: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildQuoteSendEmail(input: QuoteSendEmailInput): QuoteSendEmail {
  const firstName = escapeHtml(input.firstName || 'there')
  const orderNumber = escapeHtml(input.orderNumber)
  const jobName = escapeHtml(input.jobName || 'your production')
  const agentName = escapeHtml(input.agentName || 'the SirReel team')
  const agentEmail = input.agentEmail ? escapeHtml(input.agentEmail) : ''
  const customHtml = input.customMessage
    ? `<p style="margin:0 0 16px;">${escapeHtml(input.customMessage).replace(/\n/g, '<br>')}</p>`
    : ''
  const customText = input.customMessage ? `${input.customMessage}\n\n` : ''
  const portalUrl = input.portalUrl ?? null

  const subject = `Quote ${input.orderNumber} — ${input.jobName || 'your production'}`

  const text = [
    `Hi ${input.firstName || 'there'},`,
    ``,
    `Your quote for ${input.jobName || 'your production'} is attached.`,
    `Order number: ${input.orderNumber}.`,
    ``,
    customText,
    `Let us know if anything needs adjusting — we'll re-quote as needed.`,
    ``,
    portalUrl ? `Portal: ${portalUrl}` : '',
    `Need expendables for this shoot? ${SUPPLY_URL}`,
    ``,
    `Thanks,`,
    `${input.agentName || 'the SirReel team'}`,
    input.agentEmail ? input.agentEmail : '',
    ``,
    `SirReel Studio Rentals · ${FOOTER_ADDRESS} · ${FOOTER_PHONE}`,
  ]
    .filter((l) => l !== null && l !== undefined && l !== '')
    .join('\n')

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- Lock the rendering scheme to LIGHT. iOS / macOS Mail dark mode was
     auto-inverting the white card bg (turning the body dark) while
     leaving the inline #333 text alone — result: dark-on-dark, unread-
     able. Declaring "light" + the matching :root CSS tells Mail and
     other adaptive clients NOT to invert; the inline hex colors then
     render exactly as authored. -->
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>Quote ${orderNumber} — ${jobName}</title>
<style type="text/css">
  :root { color-scheme: light; supported-color-schemes: light; }
</style>
<!--[if mso]>
<style type="text/css">
table, td, div, h1, h2, h3, p { font-family: Georgia, 'Times New Roman', serif !important; }
</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f5f5f3;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <!-- Preheader (hidden in body, shown in inbox preview) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:transparent;height:0;width:0;opacity:0;">
    Your SirReel quote for ${jobName} — order ${orderNumber} — is attached.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f5f3;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <!-- ── Dark header with WHITE wordmark ───────────────────── -->
          <tr>
            <td style="background-color:${DARK};padding:36px 24px 28px;text-align:center;">
              <img src="${ABSOLUTE_LOGO_URL_WHITE}" alt="SirReel Studio Services" width="220" style="display:inline-block;max-width:220px;width:220px;height:auto;border:0;outline:none;text-decoration:none;" />
              <!-- Gold accent line -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:18px auto 0;">
                <tr>
                  <td style="width:48px;height:2px;background-color:${GOLD};line-height:2px;font-size:0;">&nbsp;</td>
                </tr>
              </table>
              <div style="margin-top:14px;color:${GOLD};font-size:10px;letter-spacing:2.5px;text-transform:uppercase;font-weight:600;">
                Your Quote
              </div>
              <div style="margin-top:6px;color:#ffffff;font-size:20px;letter-spacing:3px;font-weight:300;">
                ${orderNumber}
              </div>
            </td>
          </tr>

          <!-- ── Title ─────────────────────────────────────────────── -->
          <tr>
            <td style="padding:36px 36px 0;text-align:center;">
              <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;font-weight:400;color:#1a1a1a;">
                ${jobName}
              </h1>
            </td>
          </tr>

          <!-- ── Body ──────────────────────────────────────────────── -->
          <tr>
            <td style="padding:24px 36px 8px;font-size:15px;line-height:1.6;color:#333333;">
              <p style="margin:0 0 16px;">Hi ${firstName},</p>
              <p style="margin:0 0 16px;">
                Your quote for <strong>${jobName}</strong> is attached as a PDF. Order number <strong>${orderNumber}</strong>.
              </p>
              ${customHtml}
              <p style="margin:0;">
                Let us know if anything needs adjusting &mdash; we&rsquo;ll re-quote as needed.
              </p>
            </td>
          </tr>

          <!-- ── Standing CTAs (portal + supply) ───────────────────── -->
          <!-- Portal button renders when the order has a portalSlug — gives
               the client a one-tap path to review, sign, and pay without
               a reply round-trip. Supply link is unconditional ("standing"
               link) so every quote reply quietly carries the up-sell path
               whether the agent thought to mention it or not. -->
          <tr>
            <td style="padding:20px 36px 8px;text-align:center;">
              ${portalUrl ? `
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${portalUrl}" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="14%" stroke="f" fillcolor="${GOLD}">
                <w:anchorlock/>
                <center style="color:#1a1a1a;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:bold;">Open Your Portal</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <a href="${portalUrl}" style="display:inline-block;background-color:${GOLD};color:#1a1a1a;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:6px;margin:0 6px 8px;">
                Open Your Portal
              </a>
              <!--<![endif]-->
              ` : ''}
              <a href="${SUPPLY_URL}" style="display:inline-block;background-color:transparent;color:${DARK};text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:6px;border:1.5px solid ${DARK};margin:0 6px 8px;">
                Order Supplies
              </a>
            </td>
          </tr>

          <!-- ── Sign-off ──────────────────────────────────────────── -->
          <tr>
            <td style="padding:28px 36px 32px;font-size:14px;line-height:1.55;color:#333333;border-top:1px solid #ececec;margin-top:24px;">
              <p style="margin:0 0 6px;">Thanks,</p>
              <p style="margin:0;">
                <strong style="color:#1a1a1a;">${agentName}</strong><br />
                ${agentEmail ? `<a href="mailto:${agentEmail}" style="color:${LINK_GRAY};text-decoration:none;">${agentEmail}</a>` : ''}
              </p>
            </td>
          </tr>

          <!-- ── Footer (compact S-mark + address) ─────────────────── -->
          <tr>
            <td style="background-color:${DARK};padding:20px 36px;text-align:center;">
              <img src="${ABSOLUTE_S_MARK_URL_WHITE}" alt="SirReel" width="28" style="display:inline-block;max-width:28px;width:28px;height:auto;border:0;outline:none;text-decoration:none;" />
              <p style="margin:8px 0 0;font-size:10px;line-height:1.6;color:#9a9a9a;letter-spacing:0.3px;">
                SirReel Studio Rentals<br />
                ${FOOTER_ADDRESS} &middot; ${FOOTER_PHONE}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, html, text }
}
