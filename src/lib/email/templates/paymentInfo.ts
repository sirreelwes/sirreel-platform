/**
 * Payment Info & ACH email (Wes ruled A). SENSITIVE — this is the ONLY
 * delivery surface for SirReel's banking details: email to a resolved
 * on-file address. Never rendered in a browser, never a public file,
 * never a token link (plain forwardable body so the client can hand it
 * to their AP department — no images required to read the details, no
 * expiring links).
 *
 * Brand: dark header + SirReel wordmark, gold rules, label/value rows
 * for the details, a distinct callout for the fraud warning. Matches
 * the client-portal look (quoteSend / thankYou).
 */

const GOLD = '#D4A547'
const SLATE = '#0f172a'

// Verbatim per ruling — do not edit without Wes.
export const FRAUD_WARNING =
  "SirReel's payment details never change. If you receive any notice of updated banking information, call 888.477.7335 before sending funds."

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Parse the admin-entered details into label/value rows for the HTML
 * artifact. A line "Routing number: 12345" splits on the FIRST colon
 * into a label + value; a line with no colon renders full-width (a
 * heading or free note). Blank lines become spacers. The plain-text
 * alternative keeps the raw lines verbatim so nothing is lost or
 * reworded between the two parts.
 */
interface DetailRow {
  kind: 'pair' | 'full' | 'spacer'
  label?: string
  value?: string
  text?: string
}

function parseDetailRows(details: string): DetailRow[] {
  return details
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((raw): DetailRow => {
      const line = raw.trim()
      if (!line) return { kind: 'spacer' }
      const idx = line.indexOf(':')
      // Treat as a label/value pair only when the colon isn't at the
      // very start/end and the label is short-ish (a real field name).
      if (idx > 0 && idx < line.length - 1 && idx <= 40) {
        return { kind: 'pair', label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() }
      }
      return { kind: 'full', text: line }
    })
}

function renderDetailRowsHtml(rows: DetailRow[]): string {
  const cells = rows
    .map((r) => {
      if (r.kind === 'spacer') return `<tr><td colspan="2" style="height:8px;"></td></tr>`
      if (r.kind === 'full') {
        return `<tr><td colspan="2" style="padding:5px 0;font-size:14px;font-weight:700;color:#1f2937;">${escapeHtml(r.text!)}</td></tr>`
      }
      return `<tr>
        <td style="padding:6px 14px 6px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;white-space:nowrap;vertical-align:top;">${escapeHtml(r.label!)}</td>
        <td style="padding:6px 0;font-size:14px;color:#111827;font-weight:600;">${escapeHtml(r.value!)}</td>
      </tr>`
    })
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">${cells}</table>`
}

export function buildPaymentInfoEmail(input: {
  firstName: string | null
  /** Canonical payee name (SiteSetting.paymentPayeeName) — rendered in
   *  the email; NOT hardcoded in the template. */
  payeeName: string | null
  /** Admin-managed plain-text details (SiteSetting.paymentDetails). */
  paymentDetails: string
}): { subject: string; html: string; text: string } {
  const first = input.firstName?.trim() || 'there'
  const payee = input.payeeName?.trim() || null
  const subject = 'SirReel — payment information'
  const rows = parseDetailRows(input.paymentDetails.trim())

  // ── Plain-text alternative — same details + same warning verbatim ──
  const text = [
    `Hi ${first},`,
    '',
    payee
      ? `As requested, here is ${payee}'s payment information. Feel free to forward this to your accounts-payable team.`
      : 'As requested, here is SirReel’s payment information. Feel free to forward this to your accounts-payable team.',
    '',
    ...(payee ? [`Payee: ${payee}`, ''] : []),
    input.paymentDetails.trim(),
    '',
    `IMPORTANT: ${FRAUD_WARNING}`,
    '',
    'Questions? Reply to this email or call 888.477.7335.',
    payee ? `\n${payee}` : '\nSirReel Studio Services',
  ].join('\n')

  const payeeRowHtml = payee
    ? `<tr>
        <td style="padding:6px 14px 6px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;white-space:nowrap;vertical-align:top;">Payee</td>
        <td style="padding:6px 0;font-size:14px;color:#111827;font-weight:700;">${escapeHtml(payee)}</td>
       </tr>
       <tr><td colspan="2" style="height:8px;"></td></tr>`
    : ''

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f2;">
  <div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <!-- header -->
    <div style="background:${SLATE};padding:24px 28px;border-bottom:3px solid ${GOLD};">
      <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:0.04em;">SIRREEL</span>
      <span style="color:${GOLD};font-size:11px;font-weight:700;letter-spacing:0.18em;margin-left:10px;">STUDIO SERVICES</span>
    </div>
    <div style="background:#ffffff;padding:28px;">
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Hi ${escapeHtml(first)},</p>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;">
        As requested, here is ${payee ? escapeHtml(payee) + '&rsquo;s' : 'SirReel&rsquo;s'} payment information.
        Feel free to forward this email to your accounts-payable team.
      </p>

      <!-- details card: gold rule + label/value rows -->
      <div style="border:1px solid #e5e2d9;border-radius:10px;overflow:hidden;margin:0 0 20px;">
        <div style="background:${SLATE};height:4px;line-height:4px;font-size:0;">&nbsp;</div>
        <div style="padding:18px 20px;background:#faf9f6;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:${GOLD};margin:0 0 12px;">Payment details</div>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
            ${payeeRowHtml}
          </table>
          ${renderDetailRowsHtml(rows)}
        </div>
      </div>

      <!-- fraud warning: distinct callout, not body text -->
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 20px;">
        <tr>
          <td style="width:5px;background:#c2410c;border-radius:8px 0 0 8px;">&nbsp;</td>
          <td style="background:#fff7ed;border:1px solid #fdba74;border-left:none;border-radius:0 8px 8px 0;padding:14px 16px;">
            <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#c2410c;margin:0 0 4px;">⚠ Fraud warning</div>
            <div style="font-size:13px;line-height:1.6;color:#7c2d12;">${escapeHtml(FRAUD_WARNING)}</div>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 4px;font-size:14px;line-height:1.6;">Questions? Reply to this email or call <a href="tel:8884777335" style="color:${SLATE};font-weight:700;text-decoration:none;">888.477.7335</a>.</p>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">${payee ? escapeHtml(payee) : 'SirReel Studio Services'}</p>
    </div>
  </div>
</body></html>`

  return { subject, html, text }
}
