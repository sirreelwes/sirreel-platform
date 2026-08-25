import { defaultEmailBody } from '@/lib/email/standardOpening'
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
// The S mark alone, brand black on transparency, for the LIGHT footer. The
// existing s-logo.jpg is opaque white-backed and would show a box against the
// #fafaf8 ground, so this is a generated companion to s-logo-white.png.
const ABSOLUTE_S_MARK_URL = 'https://hq.sirreel.com/s-logo-black.png'
const FOOTER_ADDRESS = '8500 Lankershim Blvd, Sun Valley, CA 91352'
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
  /**
   * Accepted but NOT rendered. Wes 2026-08-25: "it seems to have the wrong
   * phone for Wes. Let's not have a phone number in this email." Kept in the
   * signature so every caller does not have to change; drop it from the type
   * only if the wrong-number problem is fixed at the source and Wes wants it
   * back. The after-hours line is gone from the body and footer too.
   */
  repPhone?: string | null
  /** Rep email — populates the inline link under the sign-off. Also used
   *  by the caller as the Reply-To header so client replies route to
   *  the rep's inbox, not the shared notifications@ address. */
  repEmail?: string | null
  /** Agent's personal note (review-modal textarea) — an extra paragraph after
   *  the intro. Escaped + newline-converted here. Empty/null = omitted. */
  personalNote?: string | null
  /** Write-my-own mode: the rep's prose, rendered BELOW the standard opening
   *  line rather than replacing it. Greeting, benefits, CTA and sign-off stay
   *  intact. When empty, the templated TSX-portal paragraph is used instead. */
  customMessage?: string | null
  /**
   * Quick Respond mode (Wes 2026-08-25) — a reply to someone who has only
   * INQUIRED, not a portal onboarding. Two things follow from that:
   *
   *   1. No prepopulated prose. An empty box must send an empty body, not
   *      silently fall back to the default copy — otherwise the rep sees
   *      blank and the client receives the standard welcome.
   *   2. No portal apparatus. "drop the portal button for quick respond" —
   *      and with the button gone, everything that sells the portal has to
   *      go with it, or the email advertises a portal it never links to:
   *      the CTA block, the "Your TSX portal" bullet, the preheader, and
   *      the TSX brand framing. TSX is the portal brand ONLY (Wes 8/23),
   *      so non-portal client copy says SirReel.
   *
   * Greeting, the rep's own words, rep/support bullets, sign-off and the
   * SirReel footer all still render.
   */
  quickRespond?: boolean
  /** CTA button label — the welcome/job-begin invite passes
   *  "Get Paperwork Started". Defaults to the original portal wording. */
  ctaLabel?: string
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
  const repEmail = input.repEmail ? escapeHtml(input.repEmail) : ''
  const portalLink = input.portalLink
  const ctaLabel = escapeHtml(input.ctaLabel || 'Click here for your TSX portal')
  const noteRaw = (input.personalNote || '').trim()
  const customRaw = (input.customMessage || '').trim()
  // HTML-safe, newline→paragraph conversion for the injected agent copy.
  const toParas = (t: string, style: string) =>
    t
      .split(/\n{2,}/)
      .map((p) => `<p style="${style}">${escapeHtml(p).replace(/\n/g, '<br />')}</p>`)
      .join('')
  // The STANDARD line always opens (Wes, 2026-08-12) — same sentence as the
  // quick reply, from one shared constant so the two cannot drift.
  //
  // The rep's own words then FOLLOW it rather than replacing it. Previously
  // write-my-own swapped out the intro entirely, so the client's first
  // sentence changed depending on who typed it. Greeting, benefits, CTA and
  // sign-off are unchanged.
  //
  // The templated TSX-portal prose is still the fallback when a rep writes
  // nothing — it is "the rest" in that case.
  // The rep's text is the WHOLE body when present. It is not appended to a
  // fixed preamble, because the rep is given that preamble prefilled and may
  // edit or delete any of it — "the entire email should be editable".
  //
  // With nothing written, the same default renders, so the box a rep looks at
  // and the email a client receives are the same words.
  const quick = !!input.quickRespond
  const defaultIntro = quick
    ? ''
    : defaultEmailBody({ kind: 'welcome', projectName: input.projectName })
  const introHtml = customRaw
    ? toParas(customRaw, 'margin:0 0 16px;')
    : defaultIntro
      ? toParas(defaultIntro, 'margin:0 0 16px;')
      : ''
  const noteHtml = noteRaw ? toParas(noteRaw, 'margin:0 0 16px;color:#1a1a1a;') : ''
  // Same order in plain text as in HTML.
  const introText = customRaw || defaultIntro

  // "Let's get started" is onboarding language — wrong for a reply to an
  // inquiry that may never become a job.
  const subject = quick
    ? `${input.projectName || 'Your inquiry'} | SirReel Studio Services`
    : `Let\u2019s get started \u00b7 ${input.projectName || 'your project'} | SirReel Studio Services`

  const text = [
    ...(quick ? [] : [`Welcome to TSX — The SirReel Experience.`, ``]),
    `Hi ${input.firstName || 'there'},`,
    ``,
    ...(introText ? [introText] : []),
    ...(noteRaw ? ['', noteRaw] : []),
    ``,
    ...(quick
      ? [`  ✓ One team on your job — reply any time and whoever is closest picks it up`]
      : [
          `Everything you'll need lives in one place:`,
          `  ✓ Your TSX portal — paperwork, schedule, equipment, all in one place`,
          `  ✓ One team on your job — reply any time and whoever is closest picks it up`,
          ``,
          `${input.ctaLabel || 'Click here for your TSX portal'}: ${portalLink}`,
          ``,
          `Your progress saves automatically, so feel free to come back any time.`,
        ]),
    ``,
    quick ? `Looking forward to hearing from you,` : `Looking forward to the project,`,
    `${input.repName || 'the SirReel team'}`,
    repEmail ? repEmail : '',
    ``,
    `SirReel Studio Services · ${FOOTER_ADDRESS}`,
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
<title>${quick ? projectName : `Let&rsquo;s get started \u00b7 ${projectName}`}</title>
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
    ${quick ? `A note from ${repName} at SirReel Studio Services about ${projectName}.` : `Your SirReel job portal for ${projectName} is ready \u2014 paperwork, schedule, equipment, all in one place.`}
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
              ${quick ? '' : `<div style="margin-top:14px;color:${GOLD};font-size:10px;letter-spacing:2.5px;text-transform:uppercase;font-weight:600;">
                Presents
              </div>
              <div style="margin-top:6px;color:#ffffff;font-size:32px;letter-spacing:6px;font-weight:300;">
                TSX
              </div>`}
            </td>
          </tr>

          <!-- ── Title ─────────────────────────────────────────────── -->
          <tr>
            <td style="padding:36px 36px 0;text-align:center;">
              <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;font-weight:400;color:#1a1a1a;">
                ${quick ? 'Thanks for reaching out.' : 'Welcome to TSX &mdash; The SirReel Experience.'}
              </h1>
            </td>
          </tr>

          <!-- ── Body ──────────────────────────────────────────────── -->
          <tr>
            <td style="padding:24px 36px 12px;font-size:15px;line-height:1.6;color:#333333;">
              <p style="margin:0 0 16px;">Hi ${firstName},</p>
              ${introHtml}${noteHtml}
            </td>
          </tr>

          <!-- ── Benefits ──────────────────────────────────────────── -->
          <tr>
            <td style="padding:8px 36px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                ${quick ? '' : `<tr>
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
                </tr>`}
                <tr>
                  <td style="padding:10px 0;border-top:1px solid #ececec;border-bottom:1px solid #ececec;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td valign="top" width="32" style="color:${GOLD};font-size:18px;font-weight:bold;padding-top:1px;">&#10003;</td>
                        <td style="font-size:14px;line-height:1.55;color:#333333;">
                          <strong style="color:#1a1a1a;">One team on your job.</strong>
                          Reply to this email any time &mdash; whoever is closest to your
                          production picks it up, so nothing waits on one person.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── CTA ───────────────────────────────────────────────── -->
          ${/* Dropped entirely in Quick Respond: no portal button, and so no
                copy that promises one. Kept as a JS comment, not an HTML one
                — an HTML comment here ships inside the client's email. */
            quick ? '' : `<tr>
            <td style="padding:28px 36px 8px;text-align:center;">
              <p style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#1a1a1a;">
                Your portal for <strong>${projectName}</strong> is ready.
              </p>
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${portalLink}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="12%" stroke="f" fillcolor="${GOLD}">
                <w:anchorlock/>
                <center style="color:#1a1a1a;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;">${ctaLabel}</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <a href="${portalLink}" style="display:inline-block;background-color:${GOLD};color:#1a1a1a;text-decoration:none;font-weight:600;font-size:15px;padding:14px 32px;border-radius:6px;">
                ${ctaLabel}
              </a>
              <!--<![endif]-->
              <p style="margin:18px 0 0;font-size:12px;color:#888888;">
                Your progress saves automatically &mdash; come back any time.
              </p>
            </td>
          </tr>`}

          <!-- ── Sign-off ──────────────────────────────────────────── -->
          <tr>
            <td style="padding:28px 36px 32px;font-size:14px;line-height:1.55;color:#333333;border-top:1px solid #ececec;margin-top:24px;">
              <p style="margin:0 0 6px;">${quick ? 'Looking forward to hearing from you,' : 'Looking forward to the project,'}</p>
              <p style="margin:0;">
                <strong style="color:#1a1a1a;">${repName}</strong><br />
                ${repEmail ? `<a href="mailto:${repEmail}" style="color:${LINK_GRAY};text-decoration:none;">${repEmail}</a>` : ''}
              </p>
            </td>
          </tr>

          <!-- ── Footer ───────────────────────────────────────────── -->
          <tr>
            <td style="background-color:#fafaf8;padding:20px 36px;text-align:center;border-top:1px solid #ececec;">
              <img src="${ABSOLUTE_S_MARK_URL}" alt="SirReel" width="30" style="display:inline-block;width:30px;max-width:30px;height:auto;border:0;outline:none;text-decoration:none;" />
              <p style="margin:8px 0 0;font-size:10px;line-height:1.6;color:#888888;letter-spacing:0.3px;">
                SirReel Studio Services<br />
                ${FOOTER_ADDRESS}
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
