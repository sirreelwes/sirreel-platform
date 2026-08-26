/**
 * "Authorize a card for your rental" — the client-facing half of the job
 * page's Card Authorization tile.
 *
 * Before this existed the tile's "Send CC request" button sent nothing at
 * all: it minted a portal token and copied the URL to the clipboard, so
 * the only way to know whether a client had been asked was to remember
 * doing it (Wes 2026-08-26). It now goes out through EmailReviewModal
 * like every other client-facing send — previewed, then dispatched.
 *
 * Visual language mirrors stageReadyToSign.ts / portalInvite.ts: dark
 * header with the white wordmark, gold accent, light-mode lock, table
 * layout.
 *
 * NOTE the security copy is deliberate, and so is the payment-options line. Clients are being asked for a
 * card by email, which is exactly what a phishing attempt looks like, so
 * the body says plainly that we never take card numbers over email or
 * phone and that the details go into the portal itself.
 */

import { defaultEmailBody } from '@/lib/email/standardOpening'

const ABSOLUTE_LOGO_URL_WHITE = 'https://hq.sirreel.com/sirreel-logo-white.png'
/** The S mark, for the footer. Absolute + on middleware's `/s-logo` public
 *  allowlist, because an email client fetches it unauthenticated. */
const ABSOLUTE_S_MARK_BLACK = 'https://hq.sirreel.com/s-logo-black.png'
const FOOTER_ADDRESS = '8500 Lankershim Blvd, Sun Valley, CA 91352'
const FOOTER_PHONE = '(888) 477-7335'
const GOLD = '#D4A547'
const DARK = '#0a0a0a'

export interface CardAuthRequestEmailInput {
  firstName: string | null
  jobName: string | null
  /**
   * Full v2 portal URL (https://tsx.sirreel.com/portal/v2/<token>).
   *
   * NULL in preview: the token is minted at send time, so the preview has
   * no real link to show. The template collapses the CTA to an annotation
   * rather than rendering a dead button — same treatment the quote
   * template gives an un-tokenized portal URL.
   */
  portalLink: string | null
  /** Assigned agent's first name; falls back to "your SirReel agent". */
  agentFirstName?: string | null
  /** Optional line the rep typed in the review modal. */
  personalNote?: string | null
  /**
   * "Write my own email" — the rep's prose REPLACES the templated ask and
   * the "questions, or paying another way" closer.
   *
   * What it does NOT replace: the paragraph about the number going straight
   * to the processor and us never asking for card details by email or phone.
   * That copy is the reason a client can tell this email from a phishing
   * attempt, so it is not the rep's to delete — it stays under whatever they
   * write, along with the secure button and the sign-off.
   */
  customBody?: string | null
}

export interface CardAuthRequestEmail {
  subject: string
  html: string
  text: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Rep's note → HTML paragraphs, escaped, blank lines preserved. */
function noteHtml(note: string): string {
  return note
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 16px;">${escapeHtml(para).replace(/\n/g, '<br />')}</p>`)
    .join('')
}

export function buildCardAuthRequestEmail(input: CardAuthRequestEmailInput): CardAuthRequestEmail {
  const firstNameRaw = (input.firstName || '').trim() || 'there'
  const jobNameRaw = (input.jobName || '').trim() || 'your production'
  const firstName = escapeHtml(firstNameRaw)
  const jobName = escapeHtml(jobNameRaw)
  const agentRef = (input.agentFirstName || '').trim() || 'your SirReel agent'
  const agentRefHtml = escapeHtml(agentRef)
  const note = (input.personalNote || '').trim()
  const link = input.portalLink
  const repBody = (input.customBody || '').trim()
  /**
   * The other ways to pay (Wes 2026-08-26). Two jobs in one line: it tells a
   * client the button does not charge them — it authorizes — and it names the
   * alternatives instead of leaving "paying another way" as a hint they have
   * to ask about. Part of the SHELL, like the security paragraph: a rep who
   * writes their own ask would rarely retype this, and a client who would
   * rather send a wire should not have to have drawn the rep who remembered.
   */
  const PAYMENT_OPTIONS =
    "This just secures your order — you aren't charged by adding it. If you'd rather pay another way, we also take ACH, Zelle and wire transfer; just reply and we'll send the details."
  // The standard ask, from the same function that seeds the compose box, so
  // what a rep is handed to edit is what a client receives when they don't.
  const askText = repBody || defaultEmailBody({ kind: 'card-auth', projectName: jobNameRaw })
  // Only the templated ask names the job in bold — a rep's own words are
  // rendered exactly as typed.
  const askHtml = repBody
    ? noteHtml(repBody)
    : `<p style="margin:0 0 16px;">Before we can send <strong>${jobName}</strong> out the door, we need a credit card on file to authorize the rental.</p>`

  const subject = `Card authorization for ${jobNameRaw}`

  const text = [
    `Hi ${firstNameRaw},`,
    ``,
    ...(note ? [note, ``] : []),
    askText,
    ``,
    `You can enter it yourself in your SirReel portal — it goes straight to our payment processor, and nobody at SirReel ever sees the full number. We will never ask for card details over email or on the phone.`,
    ``,
    PAYMENT_OPTIONS,
    ``,
    link ? `Authorize your card: ${link}` : `(The secure portal link is generated when this email is sent.)`,
    ``,
    // Dropped when the rep wrote the body — their words carry their own
    // next step, and ours underneath read like a second author. The line
    // no longer has to hint at "paying another way": PAYMENT_OPTIONS says it
    // outright, above the button, on every send.
    ...(repBody ? [] : [`Questions? Just reply to this email — ${agentRef} will sort it out.`, ``]),
    `Thanks,`,
    `The SirReel Team`,
    ``,
    `SirReel Studio Services · ${FOOTER_ADDRESS} · ${FOOTER_PHONE}`,
  ].join('\n')

  const ctaBlock = link
    ? `
          <!-- ── CTA ───────────────────────────────────────────────── -->
          <tr>
            <td style="padding:16px 36px 8px;text-align:center;">
              <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${link}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="12%" stroke="f" fillcolor="${GOLD}">
                <w:anchorlock/>
                <center style="color:#1a1a1a;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;">Authorize your card &rarr;</center>
              </v:roundrect>
              <![endif]-->
              <!--[if !mso]><!-- -->
              <a href="${link}" style="display:inline-block;background-color:${GOLD};color:#1a1a1a;text-decoration:none;font-weight:600;font-size:15px;padding:14px 32px;border-radius:6px;">
                Authorize your card &rarr;
              </a>
              <!--<![endif]-->
            </td>
          </tr>`
    : `
          <!-- ── CTA placeholder (preview: no token minted yet) ─────── -->
          <tr>
            <td style="padding:16px 36px 8px;text-align:center;">
              <div style="display:inline-block;border:1px dashed #c9c9c4;border-radius:6px;padding:13px 30px;font-size:13px;color:#8a8a84;">
                Secure portal button &mdash; the link is generated when you send
              </div>
            </td>
          </tr>`

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
  <!-- Preheader (hidden in body, shown in inbox preview) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:transparent;height:0;width:0;opacity:0;">
    Add a card for ${jobName} in your secure SirReel portal.
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
                Card Authorization
              </div>
            </td>
          </tr>

          <!-- ── Title ─────────────────────────────────────────────── -->
          <tr>
            <td style="padding:36px 36px 0;text-align:center;">
              <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;font-weight:400;color:#1a1a1a;">
                One last thing.
              </h1>
            </td>
          </tr>

          <!-- ── Body ──────────────────────────────────────────────── -->
          <tr>
            <td style="padding:24px 36px 8px;font-size:15px;line-height:1.6;color:#333333;">
              <p style="margin:0 0 16px;">Hi ${firstName},</p>
              ${note ? noteHtml(note) : ''}
              ${askHtml}
              <p style="margin:0 0 16px;">
                You can enter it yourself in your SirReel portal &mdash; it goes straight to our payment processor, and nobody at SirReel ever sees the full number. We will never ask for card details over email or on the phone.
              </p>
              ${/* Sits ABOVE the button on purpose — "you aren't charged by
                     adding it" is reassurance a client needs before they
                     click, not after. */ ''}<p style="margin:0 0 16px;">
                ${escapeHtml(PAYMENT_OPTIONS)}
              </p>
            </td>
          </tr>
${ctaBlock}

          <!-- ── Sign-off ──────────────────────────────────────────── -->
          <tr>
            <td style="padding:24px 36px 32px;font-size:14px;line-height:1.55;color:#333333;">
              ${repBody ? '' : `<p style="margin:0 0 6px;">Questions? Just reply to this email &mdash; ${agentRefHtml} will sort it out.</p>`}
              <p style="margin:12px 0 0;">
                Thanks,<br />
                <strong style="color:#1a1a1a;">The SirReel Team</strong>
              </p>
            </td>
          </tr>

          <!-- ── Footer ───────────────────────────────────────────── -->
          <tr>
            <td style="background-color:#fafaf8;padding:20px 36px;text-align:center;border-top:1px solid #ececec;">
              ${/* The S mark replaces the Georgia "SirReel" wordmark that
                     used to sit here (Wes 2026-08-26). alt text still reads
                     SirReel, so a client with images off is no worse off than
                     the word it replaced. The width ATTRIBUTE matters as much
                     as the CSS: Outlook's Word engine ignores the style and
                     would otherwise render the source at its full 1118px.
                     A JS comment, not an HTML one — this note is for us, and
                     an HTML comment would ride along into the client's
                     inbox. */ ''}<img
                src="${ABSOLUTE_S_MARK_BLACK}"
                alt="SirReel"
                width="26"
                style="display:inline-block;width:26px;max-width:26px;height:auto;border:0;outline:none;text-decoration:none;opacity:0.6;"
              />
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
