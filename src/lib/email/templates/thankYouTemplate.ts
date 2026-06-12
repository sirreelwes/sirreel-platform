/**
 * Post-job thank-you email template.
 *
 * ⚠️  PLACEHOLDER COPY — NEEDS WES REVIEW BEFORE FIRST REAL SEND  ⚠️
 *
 * The structural shell (logo, typography, photo slot, sign-off block,
 * footer) is final. The actual prose — subject line, opening, the
 * "thanks for choosing us" paragraph — is a starting draft only.
 * Search for `[[PLACEHOLDER]]` in this file to find every spot that
 * carries placeholder language. Replace before the team starts
 * sending real thank-yous.
 *
 * Brand: dark header on `bg-[#0f172a]` (slate-950) matching the
 * SirReel logo, gold accent `#D4A547`, warm body copy. The candid
 * photo (when present) gets a generous slot below the salutation
 * so it carries the moment. Hosted Blob URL only — Gmail blocks
 * `data:` URIs.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const ACCENT = '#D4A547'
const HEADER_BG = '#0f172a'
const TEXT = '#1f2937'
const MUTED = '#6b7280'

export interface ThankYouTemplateInput {
  clientFirstName: string | null
  clientFullName: string | null
  jobName: string | null
  orderNumber: string
  wrapDate: string | null // ISO
  agentName: string
  agentDisplayTitle: string | null
  agentEmail: string
  agentPhone: string | null
  /** Hosted Blob URL of the candid (or null when the rep is sending
   *  without a photo — the slot collapses gracefully). */
  photoUrl: string | null
  /** Caption rendered directly under the candid. DEFAULT is no
   *  caption — the slot stays empty unless the rep types one in on
   *  the compose page. The rep often wants the photo to speak for
   *  itself; the template no longer assumes a canned "moment from
   *  your shoot" line. */
  photoCaption: string | null
  /** Optional single-line addition the rep types above the templated
   *  body. Already-escaped before reaching here is fine; we re-escape
   *  to be safe. */
  personalNote: string | null
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function buildThankYouEmail(input: ThankYouTemplateInput): RenderedEmail {
  const first = input.clientFirstName?.trim() || input.clientFullName?.trim()?.split(/\s+/)[0] || 'there'
  const safeFirst = escapeHtml(first)
  const safeJob = input.jobName ? escapeHtml(input.jobName) : null
  const safeAgentName = escapeHtml(input.agentName)
  const safeAgentTitle = input.agentDisplayTitle ? escapeHtml(input.agentDisplayTitle) : null
  const safeNote = input.personalNote ? escapeHtml(input.personalNote.trim()) : null
  const safePhone = input.agentPhone ? escapeHtml(input.agentPhone) : null

  // [[PLACEHOLDER]] subject — Wes review.
  const subject = safeJob
    ? `Thanks for trusting us with ${first === 'there' ? 'your shoot' : `${first}'s show`}`
    : `Thanks from SirReel`

  // [[PLACEHOLDER]] body paragraphs — Wes review.
  const greeting = `Hey ${safeFirst},`
  const opener = safeJob
    ? `Just wanted to say thank you for bringing <strong>${safeJob}</strong> to us. The whole team enjoyed working with you on this one.`
    : `Just wanted to say thank you for the recent shoot — the whole team enjoyed working with you.`
  const middle = `If anything came up at wrap that we didn't catch, hit reply and let me know directly. We track every job like this so the next one's easier.`
  const closer = `Looking forward to the next show.`

  const safeCaption = input.photoCaption?.trim() ? escapeHtml(input.photoCaption.trim()) : null
  const photoBlock = input.photoUrl
    ? `
      <tr>
        <td style="padding: 24px 32px 8px;">
          <img
            src="${escapeHtml(input.photoUrl)}"
            alt="From your shoot with SirReel"
            style="display: block; width: 100%; max-width: 536px; height: auto; border-radius: 12px; border: 1px solid #e5e7eb;"
          />
          ${safeCaption
            ? `<p style="font-size: 12px; color: ${MUTED}; margin: 8px 0 0; text-align: center; font-style: italic;">${safeCaption}</p>`
            : ''}
        </td>
      </tr>`
    : ''

  const personalNoteBlock = safeNote
    ? `
      <tr>
        <td style="padding: 0 32px 16px;">
          <p style="font-size: 16px; line-height: 1.6; color: ${TEXT}; margin: 0; font-style: italic; border-left: 3px solid ${ACCENT}; padding-left: 12px;">${safeNote}</p>
        </td>
      </tr>`
    : ''

  // Sign-off: the rep's name + "Team SirReel" — the warm "you and
  // the whole crew" feel rather than a corporate department line.
  // The displayTitle is intentionally NOT used here.
  const signOff = `${safeAgentName}<br/><span style="color: ${MUTED}; font-size: 14px;">&amp; Team SirReel</span>`

  const wrap = fmtDate(input.wrapDate)
  const orderLine = wrap
    ? `Order ${escapeHtml(input.orderNumber)} · Wrapped ${escapeHtml(wrap)}`
    : `Order ${escapeHtml(input.orderNumber)}`

  // TSX tagline — "T S X - T H E  S I R R E E L  E X P E R I E N C E"
  // with letters that are lowercase in the natural casing rendered as
  // smaller capitals (mimics small-caps without relying on
  // `font-variant-caps`, which Gmail and Outlook don't honor
  // reliably). Big letters mirror the natural uppercases in TSX +
  // The + SirReel + Experience.
  const bigCap = (c: string) => `<span style="font-size:13px;">${c}</span>`
  const smCap  = (c: string) => `<span style="font-size:10px;">${c}</span>`
  const wordGap = '<span style="display:inline-block;width:10px;">&nbsp;</span>'
  const dashGap = `<span style="font-size:11px;color:rgba(212,165,71,0.6);margin:0 6px;">&ndash;</span>`
  const tsxTagline = [
    bigCap('T'), bigCap('S'), bigCap('X'),
    dashGap,
    bigCap('T'), smCap('H'), smCap('E'),
    wordGap,
    bigCap('S'), smCap('I'), smCap('R'), bigCap('R'), smCap('E'), smCap('E'), smCap('L'),
    wordGap,
    bigCap('E'), smCap('X'), smCap('P'), smCap('E'), smCap('R'), smCap('I'), smCap('E'), smCap('N'), smCap('C'), smCap('E'),
  ].join('')

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 24px 12px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
          <tr>
            <td style="background-color: ${HEADER_BG}; padding: 20px 32px;">
              <!--
                Two-column header: logo left, "Thank you" badge right.
                Cursive on a -12deg tilt so it reads like a stamped
                badge. Outlook desktop strips CSS transforms and may
                fall back to Comic-Sans-ish for cursive — accept that;
                Gmail web/mobile, Apple Mail, iOS Mail render the
                intended look. Font stack ordered: a script-y fallback
                Apple devices ship (Snell Roundhand), then web-safe
                cursives (Brush Script MT, Lucida Handwriting), then
                generic cursive. Gold (${ACCENT}) matches the brand
                accent already used in the personal-note bar below.
              -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td valign="middle" align="left" style="width: 60%;">
                    <img
                      src="https://hq.sirreel.com/sirreel-logo-white.png"
                      alt="SirReel"
                      style="height: 28px; width: auto; display: block;"
                    />
                  </td>
                  <td valign="middle" align="right" style="width: 40%;">
                    <!--
                      Right-side badge sized to roughly match the
                      SirReel logo's horizontal footprint. 35° tilt
                      keeps the "stamped on" feel without the larger
                      grade-overflow look — neat, badge-like.
                    -->
                    <span style="
                      display: inline-block;
                      font-family: 'Bradley Hand ITC', 'Bradley Hand', 'Segoe Print', 'Marker Felt', 'Comic Sans MS', cursive;
                      font-size: 22px;
                      font-weight: 700;
                      color: ${ACCENT};
                      transform: rotate(-20deg);
                      -webkit-transform: rotate(-20deg);
                      -ms-transform: rotate(-20deg);
                      text-shadow: 0 1px 0 rgba(0,0,0,0.25);
                      line-height: 1;
                      padding: 0 4px;
                      white-space: nowrap;
                    ">Thank you!</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px 4px;">
              <p style="font-size: 17px; color: ${TEXT}; margin: 0 0 12px; line-height: 1.5;">${greeting}</p>
              <p style="font-size: 16px; color: ${TEXT}; margin: 0 0 12px; line-height: 1.6;">${opener}</p>
            </td>
          </tr>
          ${personalNoteBlock}
          ${photoBlock}
          <tr>
            <td style="padding: 16px 32px 4px;">
              <p style="font-size: 16px; color: ${TEXT}; margin: 0 0 12px; line-height: 1.6;">${middle}</p>
              <p style="font-size: 16px; color: ${TEXT}; margin: 0 0 24px; line-height: 1.6;">${closer}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 32px 28px;">
              <p style="font-size: 16px; color: ${TEXT}; margin: 0; line-height: 1.5;">
                — ${signOff}
              </p>
              ${safePhone ? `<p style="font-size: 13px; color: ${MUTED}; margin: 6px 0 0;">${safePhone}</p>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding: 18px 32px 0;">
              <!-- Upper gold rule — frames the TSX tagline together
                   with the lower rule below. -->
              <div style="height: 1px; line-height: 1px; font-size: 0; background-color: ${ACCENT};">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 8px 32px 6px;">
              <!-- TSX tagline. Modern thin sans, widely letter-
                   spaced, all-caps with small-caps for letters that
                   are lowercase in natural casing. -->
              <p style="
                font-family: 'Helvetica Neue', 'Segoe UI', Helvetica, Arial, sans-serif;
                font-weight: 300;
                letter-spacing: 0.32em;
                color: ${ACCENT};
                margin: 0;
                line-height: 1.4;
              ">${tsxTagline}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 6px 32px 0;">
              <!-- Gold separator under the tagline. div used instead
                   of <hr> for consistent rendering across clients. -->
              <div style="height: 1px; line-height: 1px; font-size: 0; background-color: ${ACCENT};">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 12px 32px 18px;">
              <p style="font-size: 11px; color: ${MUTED}; margin: 0; line-height: 1.4;">
                ${orderLine}
              </p>
              <p style="font-size: 11px; color: ${MUTED}; margin: 4px 0 0; line-height: 1.4;">
                8500 Lankershim Blvd, Sun Valley CA 91352 · 888.477.7335
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const textGreeting = `Hey ${first},`
  const textOpener = input.jobName
    ? `Just wanted to say thank you for bringing ${input.jobName} to us. The whole team enjoyed working with you on this one.`
    : `Just wanted to say thank you for the recent shoot — the whole team enjoyed working with you.`
  const textMiddle = `If anything came up at wrap that we didn't catch, hit reply and let me know directly. We track every job like this so the next one's easier.`
  const textCloser = `Looking forward to the next show.`
  const textNote = input.personalNote?.trim() ? `\n\n${input.personalNote.trim()}\n` : ''
  const textPhotoNote = input.photoUrl ? `\n\n[Photo from your shoot — view in HTML version]` : ''
  const textSignOff = `${input.agentName}\n& Team SirReel`
  const textPhone = input.agentPhone ? `\n${input.agentPhone}` : ''
  const text = [
    textGreeting,
    '',
    textOpener,
    textNote.trim() || '',
    textPhotoNote.trim() || '',
    '',
    textMiddle,
    '',
    textCloser,
    '',
    `— ${textSignOff}${textPhone}`,
    '',
    'TSX — The SirReel Experience',
    '---',
    `${orderLine}`,
    `8500 Lankershim Blvd, Sun Valley CA 91352 · 888.477.7335`,
  ].filter((s) => s !== null).join('\n')

  return { subject, html, text }
}
