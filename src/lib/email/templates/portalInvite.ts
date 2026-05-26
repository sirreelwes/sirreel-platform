/**
 * TSX portal invitation email — the first email a new client receives
 * after being added to the SirReel Job Page portal. Aims for the
 * Amex-Platinum-welcome / Stripe-onboarding register rather than a
 * transactional "your access is ready" tone.
 *
 * Brand framing:
 *   - "SirReel presents TSX" — TSX is the platform-as-product.
 *   - "The SirReel Experience" — the overall service philosophy.
 *
 * HTML rules (all enforced below):
 *   - Table-based layout (no flexbox / grid; email clients lack support).
 *   - Inline CSS everywhere. No <style> blocks beyond a minimal reset
 *     for unsupporting clients.
 *   - Absolute URL for the logo (email clients can't resolve relative
 *     paths). Falls back to text when images are blocked.
 *   - Dark header band with gold accent for visual identity that
 *     survives Outlook's CSS stripping.
 *   - Single-column mobile layout (max-width 600px).
 *   - Color scheme: locked to LIGHT via meta + :root CSS. Apple Mail
 *     dark mode was inverting the white card bg while leaving inline
 *     #333 text alone, producing dark-on-dark unreadable body copy.
 *     The dark header band keeps its visual identity regardless.
 */

// White wordmark (RGB-inverted from /public/sirreel-logo.png so the SirReel
// logo reads cleanly against the DARK header background). The black
// original is kept for any light-bg uses elsewhere; this email always uses
// the white version. Both are served as static assets from /public via
// Vercel's CDN, which is required for email image rendering — email
// clients can't resolve relative paths or local files.
const ABSOLUTE_LOGO_URL_WHITE = 'https://hq.sirreel.com/sirreel-logo-white.png'
const FOOTER_ADDRESS = '8500 Lankershim Blvd, Sun Valley, CA 91352'
const FOOTER_PHONE = '(888) 477-7335'
const GOLD = '#D4A547'
const DARK = '#0a0a0a'
const LINK_GRAY = '#9a9a9a'

export interface PortalInviteEmailInput {
  firstName: string
  /** "Project Atlas" / "Big Studio Q3" — whatever the client calls the job. */
  projectName: string
  /** Full magic-link URL with token (e.g. https://hq.sirreel.com/portal/job/<slug>?token=...). */
  portalLink: string
  /** Rep name as it should appear in the sign-off. */
  repName: string
  /** Optional — appears below the rep name when present. */
  repPhone?: string | null
  repEmail?: string | null
  /** Magic-link TTL. Defaults to 7 days, matching jobMagicLink.ts. */
  expirationDays?: number
}

export interface PortalInviteEmail {
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
}

export function buildPortalInviteEmail(input: PortalInviteEmailInput): PortalInviteEmail {
  const firstName = escapeHtml(input.firstName || 'there')
  const projectName = escapeHtml(input.projectName || 'your project')
  const repName = escapeHtml(input.repName || 'the SirReel team')
  const repPhone = input.repPhone ? escapeHtml(input.repPhone) : ''
  const repEmail = input.repEmail ? escapeHtml(input.repEmail) : ''
  const portalLink = input.portalLink // already URL-encoded by caller
  const days = input.expirationDays ?? 7

  const subject = `Welcome to The SirReel Experience · ${input.projectName || 'your project portal'}`

  const text = [
    `Welcome to The SirReel Experience.`,
    ``,
    `Hi ${input.firstName || 'there'},`,
    ``,
    `SirReel presents TSX — your portal to your current and past projects.`,
    ``,
    `From this single portal you can:`,
    `  ✓ Sign your rental agreement and upload your COI`,
    `  ✓ See pickup and return details, your equipment list, and your schedule`,
    `  ✓ Reach your rep and our after-hours line whenever you need us`,
    ``,
    `Your portal for ${input.projectName || 'this project'} is ready.`,
    ``,
    `Open it here: ${portalLink}`,
    ``,
    `Link is good for ${days} days. If it expires, reach out and we'll send a fresh one.`,
    ``,
    `Best,`,
    `${input.repName || 'the SirReel team'}`,
    repPhone ? repPhone : '',
    repEmail ? repEmail : '',
    ``,
    `SirReel Studio Rentals · ${FOOTER_ADDRESS} · ${FOOTER_PHONE}`,
  ]
    .filter((l) => l !== null && l !== undefined)
    .join('\n')

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- Lock to LIGHT — see quoteSend.ts for the Apple Mail dark-mode
     inversion bug this prevents. -->
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>Welcome to The SirReel Experience</title>
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
    SirReel presents TSX — your online portal to The SirReel Experience.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f5f3;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <!-- ── Dark header ────────────────────────────────────────── -->
          <tr>
            <td style="background-color:${DARK};padding:36px 24px 28px;text-align:center;">
              <!-- White SirReel wordmark over the dark header. Alt text matches what shows
                   when images are blocked (Gmail "Display images below", Outlook safe view). -->
              <img src="${ABSOLUTE_LOGO_URL_WHITE}" alt="SirReel Studio Services" width="200" style="display:inline-block;max-width:200px;width:200px;height:auto;border:0;outline:none;text-decoration:none;" />
              <!-- Gold accent line -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:18px auto 0;">
                <tr>
                  <td style="width:48px;height:2px;background-color:${GOLD};line-height:2px;font-size:0;">&nbsp;</td>
                </tr>
              </table>
              <div style="margin-top:14px;color:${GOLD};font-size:10px;letter-spacing:2.5px;text-transform:uppercase;font-weight:600;">
                Presents
              </div>
              <div style="margin-top:6px;color:#ffffff;font-size:32px;letter-spacing:6px;font-weight:300;">
                TSX
              </div>
            </td>
          </tr>

          <!-- ── Title ─────────────────────────────────────────────── -->
          <tr>
            <td style="padding:36px 36px 0;text-align:center;">
              <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;font-weight:400;color:#1a1a1a;">
                Welcome to<br />The SirReel Experience.
              </h1>
            </td>
          </tr>

          <!-- ── Body ──────────────────────────────────────────────── -->
          <tr>
            <td style="padding:24px 36px 12px;font-size:15px;line-height:1.6;color:#333333;">
              <p style="margin:0 0 16px;">Hi ${firstName},</p>
              <p style="margin:0 0 16px;">
                We&rsquo;re glad to be working with you on <strong>${projectName}</strong>. SirReel presents <strong>TSX</strong> &mdash; your portal to your current and past projects. One place for everything you&rsquo;ll need while you&rsquo;re with us.
              </p>
            </td>
          </tr>

          <!-- ── Benefits ──────────────────────────────────────────── -->
          <tr>
            <td style="padding:8px 36px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="padding:10px 0;border-top:1px solid #ececec;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td valign="top" width="32" style="color:${GOLD};font-size:18px;font-weight:bold;padding-top:1px;">&#10003;</td>
                        <td style="font-size:14px;line-height:1.55;color:#333333;">
                          <strong style="color:#1a1a1a;">Paperwork, handled.</strong>
                          Sign your rental agreement and upload your COI in a few clicks.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-top:1px solid #ececec;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td valign="top" width="32" style="color:${GOLD};font-size:18px;font-weight:bold;padding-top:1px;">&#10003;</td>
                        <td style="font-size:14px;line-height:1.55;color:#333333;">
                          <strong style="color:#1a1a1a;">Your project, at a glance.</strong>
                          Pickup, return, equipment list, schedule &mdash; all in one place.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-top:1px solid #ececec;border-bottom:1px solid #ececec;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td valign="top" width="32" style="color:${GOLD};font-size:18px;font-weight:bold;padding-top:1px;">&#10003;</td>
                        <td style="font-size:14px;line-height:1.55;color:#333333;">
                          <strong style="color:#1a1a1a;">A direct line, always.</strong>
                          Your rep&rsquo;s contact and our after-hours line are one tap away.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── CTA ───────────────────────────────────────────────── -->
          <tr>
            <td style="padding:28px 36px 8px;text-align:center;">
              <p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#1a1a1a;">
                Your portal for <strong>${projectName}</strong> is ready.
              </p>
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${portalLink}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="12%" stroke="f" fillcolor="${GOLD}">
                <w:anchorlock/>
                <center style="color:#1a1a1a;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;">Portal to TSX</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <a href="${portalLink}" style="display:inline-block;background-color:${GOLD};color:#1a1a1a;text-decoration:none;font-weight:600;font-size:15px;padding:14px 32px;border-radius:6px;">
                Portal to TSX
              </a>
              <!--<![endif]-->
              <p style="margin:18px 0 0;font-size:12px;color:#888888;">
                Link expires in ${days} days. If it does, reply to this email and we&rsquo;ll send a fresh one.
              </p>
            </td>
          </tr>

          <!-- ── Sign-off ──────────────────────────────────────────── -->
          <tr>
            <td style="padding:28px 36px 32px;font-size:14px;line-height:1.55;color:#333333;border-top:1px solid #ececec;margin-top:24px;">
              <p style="margin:0 0 6px;">Looking forward to the project.</p>
              <p style="margin:0;">
                <strong style="color:#1a1a1a;">${repName}</strong><br />
                ${repPhone ? `<span style="color:#555555;">${repPhone}</span><br />` : ''}
                ${repEmail ? `<a href="mailto:${repEmail}" style="color:${LINK_GRAY};text-decoration:none;">${repEmail}</a>` : ''}
              </p>
            </td>
          </tr>

          <!-- ── Footer ───────────────────────────────────────────── -->
          <tr>
            <td style="background-color:#fafaf8;padding:20px 36px;text-align:center;border-top:1px solid #ececec;">
              <!-- Footer logotype: same CSS fallback as header, scaled and muted. -->
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;line-height:1;color:#777777;letter-spacing:0.5px;">SirReel</div>
              <p style="margin:8px 0 0;font-size:10px;line-height:1.6;color:#888888;letter-spacing:0.3px;">
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
