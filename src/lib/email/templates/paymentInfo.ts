/**
 * Payment Info & ACH email (Wes ruled A). SENSITIVE — this is the ONLY
 * delivery surface for SirReel's banking details: email to a resolved
 * on-file address. Never rendered in a browser, never a public file,
 * never a token link (plain forwardable body so the client can hand it
 * to their AP department — no images required to read the details, no
 * expiring links).
 *
 * Rows are rendered directly from the STRUCTURED record — no blob
 * parsing. Blank optional fields are omitted entirely (not empty rows).
 *
 * Brand: dark header + SirReel wordmark, gold rule, label/value rows,
 * a distinct callout for the fraud warning. Matches the client-portal
 * look (quoteSend / thankYou).
 */

import type { PaymentDetailsRecord } from '@/lib/payments/paymentDetails'

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
 * Ordered label→value rows built straight from the structured record.
 * Blank/optional fields drop out here so they never render as empty
 * rows. Payee is rendered as the first (bold) row.
 */
function detailRows(r: PaymentDetailsRecord): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  const push = (label: string, value: string | null) => {
    if (value && value.trim()) rows.push({ label, value: value.trim() })
  }
  push('Payee', r.payeeName)
  push('Bank name', r.bankName)
  push('Account type', r.accountType)
  push('Account number', r.accountNumber)
  push('Routing number (ACH)', r.routingAch)
  push('Routing number (Wire)', r.routingWire)
  push('Remittance email', r.remittanceEmail)
  push('Bank address', r.bankAddress)
  push('Additional instructions', r.instructions)
  return rows
}

export function buildPaymentInfoEmail(input: {
  firstName: string | null
  details: PaymentDetailsRecord
}): { subject: string; html: string; text: string } {
  const first = input.firstName?.trim() || 'there'
  const payee = input.details.payeeName?.trim() || null
  const subject = 'SirReel — payment information'
  const rows = detailRows(input.details)

  // ── Plain-text alternative — same details + same warning verbatim ──
  const text = [
    `Hi ${first},`,
    '',
    payee
      ? `As requested, here is ${payee}'s payment information. Feel free to forward this to your accounts-payable team.`
      : 'As requested, here is SirReel’s payment information. Feel free to forward this to your accounts-payable team.',
    '',
    ...rows.map((row) => `${row.label}: ${row.value}`),
    '',
    `IMPORTANT: ${FRAUD_WARNING}`,
    '',
    'Questions? Reply to this email or call 888.477.7335.',
    payee ? `\n${payee}` : '\nSirReel Studio Services',
  ].join('\n')

  const rowsHtml = rows
    .map(
      (row, i) => `<tr>
        <td style="padding:6px 14px 6px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:#6b7280;white-space:nowrap;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:6px 0;font-size:14px;color:#111827;font-weight:${i === 0 ? 700 : 600};">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join('')

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
            ${rowsHtml}
          </table>
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
