/**
 * Booking-welcome email — the second TSX-branded HTML email in the
 * platform (sibling to portalInvite.ts). Fires when a SirReel rep
 * clicks "Send Email" on the Booking Created success modal. Replaces
 * the old mailto-pop-Mail flow, which couldn't carry HTML styling.
 *
 * Visual language mirrors src/lib/email/templates/portalInvite.ts —
 * shared brand tokens, dark hero, "Presents / TSX" lockup, gold
 * accent. Copy is different: this is the project kickoff note, not
 * the magic-link invite.
 *
 * Two templates intentionally share the markup at a syntactic level
 * (copy-paste rather than a shared shell). The second template makes
 * the duplication visible; the third would justify extracting a
 * shared <EmailShell/>.
 */

const ABSOLUTE_LOGO_URL_WHITE = 'https://hq.sirreel.com/sirreel-logo-white.png'
const FOOTER_ADDRESS = '8500 Lankershim Blvd, Sun Valley, CA 91352'
const FOOTER_PHONE = '(888) 477-7335'
const GOLD = '#D4A547'
const DARK = '#0a0a0a'
const LINK_GRAY = '#9a9a9a'

export interface BookingWelcomeEmailInput {
  /** First name of the recipient (the client). */
  firstName: string
  /** The job / production name. */
  projectName: string
  /** Full magic-link URL to the client's job portal. */
  portalLink: string
  /** Rep name as it should appear in the sign-off (e.g., "Jose Pacheco"). */
  repName: string
  /** Optional rep phone — surfaced under the rep name when present. */
  repPhone?: string | null
  /** Rep email — populates the inline link under the sign-off. Also used
   *  by the caller as the Reply-To header so client replies route to
   *  the rep's inbox, not the shared notifications@ address. */
  repEmail?: string | null
}

export interface BookingWelcomeEmail {
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

export function buildBookingWelcomeEmail(input: BookingWelcomeEmailInput): BookingWelcomeEmail {
  const firstName = escapeHtml(input.firstName || 'there')
  const projectName = escapeHtml(input.projectName || 'your project')
  const repName = escapeHtml(input.repName || 'the SirReel team')
  const repPhone = input.repPhone ? escapeHtml(input.repPhone) : ''
  const repEmail = input.repEmail ? escapeHtml(input.repEmail) : ''
  const portalLink = input.portalLink

  const subject = `Let\u2019s get started \u00b7 ${input.projectName || 'your project'} | SirReel Studio Services`

  const text = [
    `Welcome to TSX — The SirReel Experience.`,
    ``,
    `Hi ${input.firstName || 'there'},`,
    ``,
    `We're excited to take care of your team on ${input.projectName || 'this project'}.`,
    ``,
    `Everything you'll need lives in one place:`,
    `  ✓ Your TSX portal — paperwork, schedule, equipment, all in one place`,
    `  ✓ Your dedicated rep — me, from estimate to wrap`,
    `  ✓ Direct support — after-hours line ${FOOTER_PHONE} for anything urgent`,
    ``,
    `Click here for your TSX portal: ${portalLink}`,
    ``,
    `Your progress saves automatically, so feel free to come back any time.`,
    ``,
    `Looking forward to the project,`,
    `${input.repName || 'the SirReel team'}`,
    repPhone ? repPhone : '',
    repEmail ? repEmail : '',
    ``,
    `SirReel Studio Services · ${FOOTER_ADDRESS} · ${FOOTER_PHONE}`,
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
<title>Let&rsquo;s get started \u00b7 ${projectName}</title>
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
    Your SirReel job portal for ${projectName} is ready \u2014 paperwork, schedule, equipment, all in one place.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f5f3;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <!-- ── Dark header ────────────────────────────────────────── -->
          <tr>
            <td style="background-color:${DARK};padding:36px 24px 28px;text-align:center;">
              <img src="${ABSOLUTE_LOGO_URL_WHITE}" alt="SirReel Studio Services" width="200" style="display:inline-block;max-width:200px;width:200px;height:auto;border:0;outline:none;text-decoration:none;" />
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
                Welcome to TSX &mdash; The SirReel Experience.
              </h1>
            </td>
          </tr>

          <!-- ── Body ──────────────────────────────────────────────── -->
          <tr>
            <td style="padding:24px 36px 12px;font-size:15px;line-height:1.6;color:#333333;">
              <p style="margin:0 0 16px;">Hi ${firstName},</p>
              <p style="margin:0 0 16px;">
                We&rsquo;re excited to take care of your team on <strong>${projectName}</strong>. Everything you&rsquo;ll need over the course of this project lives in one place — your TSX portal.
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
                          <strong style="color:#1a1a1a;">Your TSX portal.</strong>
                          Paperwork, schedule, equipment list &mdash; all in one place, saved automatically.
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
                          <strong style="color:#1a1a1a;">Your dedicated rep.</strong>
                          I&rsquo;ll be your point of contact from estimate to wrap. Reply to this email any time.
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
                          <strong style="color:#1a1a1a;">Direct support, always.</strong>
                          After-hours line ${FOOTER_PHONE} for anything urgent during the production.
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
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${portalLink}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="12%" stroke="f" fillcolor="${GOLD}">
                <w:anchorlock/>
                <center style="color:#1a1a1a;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;">Click here for your TSX portal</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <a href="${portalLink}" style="display:inline-block;background-color:${GOLD};color:#1a1a1a;text-decoration:none;font-weight:600;font-size:15px;padding:14px 32px;border-radius:6px;">
                Click here for your TSX portal
              </a>
              <!--<![endif]-->
              <p style="margin:18px 0 0;font-size:12px;color:#888888;">
                Your progress saves automatically &mdash; come back any time.
              </p>
            </td>
          </tr>

          <!-- ── Sign-off ──────────────────────────────────────────── -->
          <tr>
            <td style="padding:28px 36px 32px;font-size:14px;line-height:1.55;color:#333333;border-top:1px solid #ececec;margin-top:24px;">
              <p style="margin:0 0 6px;">Looking forward to the project,</p>
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
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;line-height:1;color:#777777;letter-spacing:0.5px;">SirReel</div>
              <p style="margin:8px 0 0;font-size:10px;line-height:1.6;color:#888888;letter-spacing:0.3px;">
                SirReel Studio Services<br />
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
