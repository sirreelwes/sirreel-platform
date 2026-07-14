/**
 * Client "signed confirmation" — sent to the CLIENT right after they
 * complete signing the stage/studio contract, with their signed PDF
 * attached. Copy provided by Wes verbatim; branding mirrors the other
 * client touchpoints (dark header, white wordmark, gold rule,
 * light-mode lock). SEPARATE from and in addition to the internal
 * staff notification — Reply-To is the assigned agent so replies land
 * with them directly.
 */

const ABSOLUTE_LOGO_URL_WHITE = 'https://hq.sirreel.com/sirreel-logo-white.png'
const FOOTER_ADDRESS = '8500 Lankershim Blvd, Sun Valley, CA 91352'
const FOOTER_PHONE = '(888) 477-7335'
const GOLD = '#D4A547'
const DARK = '#0a0a0a'

export interface StageSignedConfirmationInput {
  clientFirstName: string
  jobName: string
  /** Assigned agent's first name — falls back to "your SirReel agent". */
  agentFirstName?: string | null
}

export interface StageSignedConfirmationEmail {
  subject: string
  html: string
  text: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildStageSignedConfirmationEmail(input: StageSignedConfirmationInput): StageSignedConfirmationEmail {
  const firstName = escapeHtml(input.clientFirstName || 'there')
  const jobName = escapeHtml(input.jobName || 'your production')
  const agentRef = (input.agentFirstName || '').trim() || 'your SirReel agent'
  const agentRefHtml = escapeHtml(agentRef)

  const subject = `Your signed SirReel contract for ${input.jobName || 'your production'}`

  const text = [
    `Hi ${input.clientFirstName || 'there'},`,
    ``,
    `Thanks — your studio contract for ${input.jobName || 'your production'} is signed and complete. Your signed copy is attached for your records.`,
    ``,
    `If anything looks off, just reply — this reaches ${agentRef} directly.`,
    ``,
    `We're looking forward to having you at SirReel.`,
    ``,
    `Thanks,`,
    `The SirReel Team`,
    ``,
    `SirReel Studio Services · ${FOOTER_ADDRESS} · ${FOOTER_PHONE}`,
  ].join('\n')

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<!-- Lock to LIGHT — see quoteSend.ts for the Apple Mail dark-mode
     inversion bug this prevents. -->
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>Your signed SirReel contract</title>
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
    Your studio contract for ${jobName} is signed and complete — signed copy attached.
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
                Studio Contract
              </div>
            </td>
          </tr>

          <!-- ── Title ─────────────────────────────────────────────── -->
          <tr>
            <td style="padding:36px 36px 0;text-align:center;">
              <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;font-weight:400;color:#1a1a1a;">
                Signed &amp; complete.
              </h1>
            </td>
          </tr>

          <!-- ── Body ──────────────────────────────────────────────── -->
          <tr>
            <td style="padding:24px 36px 8px;font-size:15px;line-height:1.6;color:#333333;">
              <p style="margin:0 0 16px;">Hi ${firstName},</p>
              <p style="margin:0 0 16px;">
                Thanks &mdash; your studio contract for <strong>${jobName}</strong> is signed and complete. Your signed copy is attached for your records.
              </p>
              <p style="margin:0 0 16px;">
                If anything looks off, just reply &mdash; this reaches ${agentRefHtml} directly.
              </p>
              <p style="margin:0 0 16px;">
                We&rsquo;re looking forward to having you at SirReel.
              </p>
            </td>
          </tr>

          <!-- ── Sign-off ──────────────────────────────────────────── -->
          <tr>
            <td style="padding:8px 36px 32px;font-size:14px;line-height:1.55;color:#333333;">
              <p style="margin:0;">
                Thanks,<br />
                <strong style="color:#1a1a1a;">The SirReel Team</strong>
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
