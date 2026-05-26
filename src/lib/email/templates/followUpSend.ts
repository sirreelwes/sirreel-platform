/**
 * Quote follow-up email — Mode A agent-driven nudges anchored to the
 * three-stage cadence in src/lib/sales/quoteCadence.ts.
 *
 * Same brand shell as quoteSend.ts (dark header with the hosted white
 * wordmark + gold accent + dark S-mark footer) so resends and follow-ups
 * read as one continuous brand voice rather than a transactional
 * afterthought.
 *
 * Stage-specific copy (in keeping with the spec):
 *   STAGE_1 (~2d in)            "did the quote land — any questions or adjustments?"
 *   STAGE_2 (~halfway)          "still planning these dates? happy to tweak or hold."
 *   STAGE_3 (~1–2d before expiry) "quote's valid through [date] — want to lock it in?"
 *
 * Standing CTAs (always rendered):
 *   - Portal link (when the order has a portalSlug)
 *   - Supply order link (/order/supplies — standing convenience URL)
 *
 * Asset references (real hosted files):
 *   - /sirreel-logo-white.png  (header)
 *   - /s-logo-white.png        (footer)
 */

import type { CadenceStage } from '@/lib/sales/quoteCadence'

const HOST = 'https://hq.sirreel.com'
const ABSOLUTE_LOGO_URL_WHITE = `${HOST}/sirreel-logo-white.png`
const ABSOLUTE_S_MARK_URL_WHITE = `${HOST}/s-logo-white.png`
const SUPPLY_URL = `${HOST}/order/supplies`

const FOOTER_ADDRESS = '8500 Lankershim Blvd, Sun Valley, CA 91352'
const FOOTER_PHONE = '(888) 477-7335'
const GOLD = '#D4A547'
const DARK = '#0a0a0a'
const LINK_GRAY = '#9a9a9a'

export interface FollowUpSendEmailInput {
  stage: CadenceStage
  firstName: string
  orderNumber: string
  jobName: string
  agentName: string
  agentEmail?: string | null
  /** ISO date the quote is valid through — required for STAGE_3 copy
   *  and the eyebrow line on STAGE_2. Falls back to "soon" when omitted. */
  validUntil?: Date | null
  /** Fully-built portal URL including ?token=… — when set, renders the
   *  "Open Your Portal" CTA. The send route mints/reuses the magic-link
   *  token (ensureLiveJobMagicLink) and builds the URL; the composer
   *  only renders it. */
  portalUrl?: string | null
  /** Optional free-text addition from the agent. */
  customMessage?: string | null
}

export interface FollowUpSendEmail {
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

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

interface StageCopy {
  eyebrow: string
  subjectSuffix: string
  bodyLead: string
  bodyClose: string
}

function copyForStage(stage: CadenceStage, validUntilLabel: string): StageCopy {
  switch (stage) {
    case 'STAGE_1':
      return {
        eyebrow: 'Quick Check-in',
        subjectSuffix: 'a quick check-in',
        bodyLead:
          'Just wanted to make sure the quote landed safely on your end — any questions or adjustments we should make?',
        bodyClose:
          "Happy to tweak line items, dates, or pricing if it'd help land this. Reply here and we'll turn it around fast.",
      }
    case 'STAGE_2':
      return {
        eyebrow: 'Still on Track?',
        subjectSuffix: `still on track${validUntilLabel ? ` — valid through ${validUntilLabel}` : ''}`,
        bodyLead:
          'Wanted to circle back — are you still planning these dates? Happy to tweak the quote, swap vehicles, or put a soft hold on the gear so it stays yours.',
        bodyClose:
          'If something on the production side has shifted, just say the word and we can re-quote or re-shape it. Otherwise the quote stays as-is.',
      }
    case 'STAGE_3':
      return {
        eyebrow: 'Quote Window Closing',
        subjectSuffix: validUntilLabel
          ? `quote valid through ${validUntilLabel} — want to lock it in?`
          : 'quote window closing — want to lock it in?',
        bodyLead: validUntilLabel
          ? `Your quote is valid through <strong>${validUntilLabel}</strong>. If you're ready to move forward, reply and we'll lock in the dates and put the gear on hold.`
          : "Your quote window is closing soon. If you're ready to move forward, reply and we'll lock in the dates and put the gear on hold.",
        bodyClose:
          "If you need a little more time, we can extend the window — just let us know where things stand.",
      }
  }
}

export function buildFollowUpSendEmail(input: FollowUpSendEmailInput): FollowUpSendEmail {
  const firstName = escapeHtml(input.firstName || 'there')
  const orderNumber = escapeHtml(input.orderNumber)
  const jobName = escapeHtml(input.jobName || 'your production')
  const agentName = escapeHtml(input.agentName || 'the SirReel team')
  const agentEmail = input.agentEmail ? escapeHtml(input.agentEmail) : ''
  const validUntilLabel = input.validUntil ? escapeHtml(fmtDate(input.validUntil)) : ''
  const stageCopy = copyForStage(input.stage, validUntilLabel)
  const customHtml = input.customMessage
    ? `<p style="margin:0 0 16px;">${escapeHtml(input.customMessage).replace(/\n/g, '<br>')}</p>`
    : ''
  const customText = input.customMessage ? `${input.customMessage}\n\n` : ''

  const portalUrl = input.portalUrl ?? null

  const subject = `${input.jobName || 'Your quote'} (${input.orderNumber}) — ${stageCopy.subjectSuffix}`

  const text = [
    `Hi ${input.firstName || 'there'},`,
    ``,
    stageCopy.bodyLead.replace(/<[^>]+>/g, ''),
    ``,
    customText,
    stageCopy.bodyClose,
    ``,
    portalUrl ? `Portal: ${portalUrl}` : '',
    `Need supplies for this shoot? ${SUPPLY_URL}`,
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
<!-- Lock to LIGHT — see quoteSend.ts for the Apple Mail dark-mode
     inversion bug this prevents. -->
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(subject)}</title>
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
  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:transparent;height:0;width:0;opacity:0;">
    ${stageCopy.bodyLead.replace(/<[^>]+>/g, '')}
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f5f5f3;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <!-- ── Dark header with WHITE wordmark ───────────────────── -->
          <tr>
            <td style="background-color:${DARK};padding:36px 24px 28px;text-align:center;">
              <img src="${ABSOLUTE_LOGO_URL_WHITE}" alt="SirReel Studio Services" width="200" style="display:inline-block;max-width:200px;width:200px;height:auto;border:0;outline:none;text-decoration:none;" />
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:18px auto 0;">
                <tr>
                  <td style="width:48px;height:2px;background-color:${GOLD};line-height:2px;font-size:0;">&nbsp;</td>
                </tr>
              </table>
              <div style="margin-top:14px;color:${GOLD};font-size:10px;letter-spacing:2.5px;text-transform:uppercase;font-weight:600;">
                ${escapeHtml(stageCopy.eyebrow)}
              </div>
              <div style="margin-top:6px;color:#ffffff;font-size:18px;letter-spacing:2.5px;font-weight:300;">
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
              <p style="margin:0 0 16px;">${stageCopy.bodyLead}</p>
              ${customHtml}
              <p style="margin:0;">${stageCopy.bodyClose}</p>
            </td>
          </tr>

          <!-- ── CTAs (portal + supply) ────────────────────────────── -->
          <tr>
            <td style="padding:24px 36px 8px;text-align:center;">
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

          <!-- ── Footer (S-mark + address) ─────────────────────────── -->
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
