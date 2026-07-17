/**
 * Payment Info & ACH email (Wes ruled A). SENSITIVE — this is the ONLY
 * delivery surface for SirReel's banking details: email to a resolved
 * on-file address. Never rendered in a browser, never a file, never a
 * token link (plain forwardable body so the client can hand it to
 * their AP department).
 *
 * Brand: dark slate header + gold accent, matching the other client
 * templates (quoteSend / thankYou).
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

export function buildPaymentInfoEmail(input: {
  firstName: string | null
  /** Admin-managed plain-text details (SiteSetting.paymentDetails). */
  paymentDetails: string
}): { subject: string; html: string; text: string } {
  const first = input.firstName?.trim() || 'there'
  const subject = 'SirReel — payment information'

  const detailsHtml = escapeHtml(input.paymentDetails.trim()).replace(/\n/g, '<br>')

  const text = [
    `Hi ${first},`,
    '',
    'As requested, here is SirReel Production Vehicles, Inc.’s payment information. Feel free to forward this to your accounts-payable team.',
    '',
    input.paymentDetails.trim(),
    '',
    `IMPORTANT: ${FRAUD_WARNING}`,
    '',
    'Questions? Reply to this email or call 888.477.7335.',
    '',
    'SirReel Production Vehicles, Inc.',
  ].join('\n')

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f2;">
  <div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="background:${SLATE};padding:22px 28px;">
      <span style="color:#ffffff;font-size:18px;font-weight:800;letter-spacing:0.04em;">SIRREEL</span>
      <span style="color:${GOLD};font-size:11px;font-weight:700;letter-spacing:0.18em;margin-left:10px;">STUDIO SERVICES</span>
    </div>
    <div style="background:#ffffff;padding:28px;">
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Hi ${escapeHtml(first)},</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
        As requested, here is SirReel Production Vehicles, Inc.&rsquo;s payment information.
        Feel free to forward this to your accounts-payable team.
      </p>
      <div style="background:#f8f7f4;border:1px solid #e5e2d9;border-left:4px solid ${GOLD};border-radius:8px;padding:16px 18px;margin:0 0 16px;font-size:14px;line-height:1.75;">
        ${detailsHtml}
      </div>
      <div style="background:#fff8e6;border:1px solid #e6cf8f;border-radius:8px;padding:12px 16px;margin:0 0 16px;">
        <p style="margin:0;font-size:13px;line-height:1.6;color:#7a5b12;"><strong>Important:</strong> ${escapeHtml(FRAUD_WARNING)}</p>
      </div>
      <p style="margin:0 0 4px;font-size:14px;line-height:1.6;">Questions? Reply to this email or call <a href="tel:8884777335" style="color:${SLATE};font-weight:700;text-decoration:none;">888.477.7335</a>.</p>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">SirReel Production Vehicles, Inc.</p>
    </div>
  </div>
</body></html>`

  return { subject, html, text }
}
