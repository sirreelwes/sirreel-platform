/**
 * Job welcome email — "here is your link to the job."
 *
 * Wes 2026-09-11. Sent from the job page (or nudged from the /jobs tile)
 * after a quote has gone out: a short hello and the client's job-page
 * link, which needs no login. The rep's words ARE the email (seeded with
 * Wes's wording — see lib/jobs/welcomeReminder.defaultJobWelcomeBody);
 * the button, the no-login note and the sign-off are the shell.
 *
 * Same HTML rules as portalInvite.ts: table layout, inline CSS, absolute
 * logo URL, locked to LIGHT (Apple Mail dark-mode inversion), dark header
 * with the turquoise rule, 600px single column. Client-facing brand is
 * "SirReel" — never the legal entity (Wes 2026-09-04).
 */

const ABSOLUTE_LOGO_URL_WHITE = 'https://hq.sirreel.com/sirreel-logo-white.png'
const FOOTER_ADDRESS = '8500 Lankershim Blvd, Sun Valley, CA 91352'
const FOOTER_PHONE = '(888) 477-7335'
const ACCENT = '#0F7A93'
const DARK = '#0a0a0a'
const LINK_GRAY = '#9a9a9a'

export interface JobWelcomeEmailInput {
  /** The client-facing job name (resolveDisplayJobName). */
  jobName: string
  /** The rep's words, greeting included. Rendered as paragraphs. */
  body: string
  /** Tokenized job-page URL. Null for a preview — the button renders
   *  inert rather than dead. */
  portalLink: string | null
  repName: string
  repPhone?: string | null
  repEmail?: string | null
  /** Magic-link TTL, matches jobMagicLink.ts. */
  expirationDays?: number
}

export interface JobWelcomeEmail {
  subject: string
  html: string
  text: string
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function proseHtml(body: string): string {
  return body
    .trim()
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 16px;">${esc(para).replace(/\n/g, '<br />')}</p>`)
    .join('')
}

export function buildJobWelcomeEmail(input: JobWelcomeEmailInput): JobWelcomeEmail {
  const jobName = input.jobName.trim() || 'your job'
  const repName = input.repName.trim() || 'the SirReel team'
  const repPhone = input.repPhone?.trim() || ''
  const repEmail = input.repEmail?.trim() || ''
  const days = input.expirationDays ?? 7
  // A preview has no token; a hash keeps the anchor a real element without
  // pointing anywhere.
  const href = input.portalLink ?? '#'

  const subject = `Welcome to SirReel · ${jobName}`

  const text = [
    input.body.trim(),
    '',
    `Open your job: ${input.portalLink ?? '(link added when sent)'}`,
    '',
    `No login needed — the link is yours. It is good for ${days} days; if it expires, reply to this email and we'll send a fresh one.`,
    '',
    'Best,',
    repName,
    repPhone,
    repEmail,
    '',
    `SirReel Studio Rentals · ${FOOTER_ADDRESS} · ${FOOTER_PHONE}`,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${esc(subject)}</title>
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
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:transparent;height:0;width:0;opacity:0;">
    Your link to ${esc(jobName)} — no login needed.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f5f3;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <tr>
            <td style="background-color:${DARK};padding:36px 24px 28px;text-align:center;">
              <img src="${ABSOLUTE_LOGO_URL_WHITE}" alt="SirReel Studio Services" width="200" style="display:inline-block;max-width:200px;width:200px;height:auto;border:0;outline:none;text-decoration:none;" />
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:18px auto 0;">
                <tr>
                  <td style="width:48px;height:2px;background-color:${ACCENT};line-height:2px;font-size:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 36px 0;">
              <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#888888;">Your job</div>
              <div style="margin-top:6px;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.25;color:#1a1a1a;">${esc(jobName)}</div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 36px 4px;font-size:15px;line-height:1.6;color:#333333;">
              ${proseHtml(input.body)}
            </td>
          </tr>

          <tr>
            <td style="padding:16px 36px 8px;text-align:center;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="12%" stroke="f" fillcolor="${ACCENT}">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;">Open your job</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <a href="${href}" style="display:inline-block;background-color:${ACCENT};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 32px;border-radius:6px;">
                Open your job
              </a>
              <!--<![endif]-->
              <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#888888;">
                No login needed &mdash; the link is yours. It is good for ${days} days; if it expires, reply to this email and we&rsquo;ll send a fresh one.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 36px 32px;font-size:14px;line-height:1.55;color:#333333;border-top:1px solid #ececec;">
              <p style="margin:0 0 6px;">Best,</p>
              <p style="margin:0;">
                <strong style="color:#1a1a1a;">${esc(repName)}</strong><br />
                ${repPhone ? `<span style="color:#555555;">${esc(repPhone)}</span><br />` : ''}
                ${repEmail ? `<a href="mailto:${esc(repEmail)}" style="color:${LINK_GRAY};text-decoration:none;">${esc(repEmail)}</a>` : ''}
              </p>
            </td>
          </tr>

          <tr>
            <td style="background-color:#fafaf8;padding:20px 36px;text-align:center;border-top:1px solid #ececec;">
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
