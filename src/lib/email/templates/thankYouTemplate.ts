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

  const photoBlock = input.photoUrl
    ? `
      <tr>
        <td style="padding: 24px 32px 8px;">
          <img
            src="${escapeHtml(input.photoUrl)}"
            alt="From your shoot with SirReel"
            style="display: block; width: 100%; max-width: 536px; height: auto; border-radius: 12px; border: 1px solid #e5e7eb;"
          />
          <p style="font-size: 12px; color: ${MUTED}; margin: 8px 0 0; text-align: center; font-style: italic;">A moment from your shoot.</p>
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

  const signOff = safeAgentTitle
    ? `${safeAgentName}<br/><span style="color: ${MUTED}; font-size: 13px;">${safeAgentTitle}, SirReel</span>`
    : `${safeAgentName}<br/><span style="color: ${MUTED}; font-size: 13px;">SirReel</span>`

  const wrap = fmtDate(input.wrapDate)
  const orderLine = wrap
    ? `Order ${escapeHtml(input.orderNumber)} · Wrapped ${escapeHtml(wrap)}`
    : `Order ${escapeHtml(input.orderNumber)}`

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
            <td style="background-color: ${HEADER_BG}; padding: 20px 32px; text-align: left;">
              <img
                src="https://hq.sirreel.com/sirreel-logo-white.png"
                alt="SirReel"
                style="height: 28px; width: auto; display: block;"
              />
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
            <td style="border-top: 1px solid #e5e7eb; padding: 16px 32px;">
              <p style="font-size: 11px; color: ${MUTED}; margin: 0; line-height: 1.4;">
                ${orderLine}
              </p>
              <p style="font-size: 11px; color: ${MUTED}; margin: 4px 0 0; line-height: 1.4;">
                SirReel Production Vehicles, Inc. · 8500 Lankershim Blvd, Sun Valley CA 91352 · 888.477.7335
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
  const textSignOff = input.agentDisplayTitle
    ? `${input.agentName}\n${input.agentDisplayTitle}, SirReel`
    : `${input.agentName}\nSirReel`
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
    '---',
    `${orderLine}`,
    `SirReel Production Vehicles, Inc. · 8500 Lankershim Blvd, Sun Valley CA 91352 · 888.477.7335`,
  ].filter((s) => s !== null).join('\n')

  return { subject, html, text }
}
