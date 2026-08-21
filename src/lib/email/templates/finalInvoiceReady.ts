/**
 * Final-invoice payment-options email — sent when an agent records a final
 * invoice on the job page, so the client hears "here's the number, here's how
 * to pay" the moment the number exists rather than when Ana reaches them on
 * the phone.
 *
 * LINK-ONLY for bank details — Wes ruled, 2026-08-18. This is an AUTOMATED
 * send fired on every final-invoice upload, which makes it SirReel's
 * highest-volume banking surface: whatever shape it has is the shape clients
 * learn to trust, and an email that inlines account numbers trains them to
 * accept the exact email invoice-redirect fraud imitates. The bank option is
 * a share link to sirreel.com (minted per send, 90-day TTL; a Resend from
 * collections mints a fresh one). Zelle and card stay inline: a swapped
 * Zelle tag is caught by confirm-the-name, and the card block carries no
 * numbers. Carries SHARE_FRAUD_WARNING — "we do not send banking details by
 * email" — which is only speakable BECAUSE this email does not.
 *
 * The operator fast-send (paymentInfo.ts, "ruled A") still inlines: rare,
 * human-reviewed per send. Aligning it is a separate call.
 *
 * Brand composed from paymentInfo.ts exports — one palette, one set of URLs,
 * so the payment emails cannot drift apart.
 *
 * Reply-To is billing@ — replies are "run my card" / "we're wiring Friday",
 * which is collections work, not the uploading agent's.
 */

import type { PaymentDetailsRecord } from '@/lib/payments/paymentDetails'
import { CARD_AUTH_URL, GOLD, LOGO_URL_WHITE, SLATE } from '@/lib/email/templates/paymentInfo'
import { SHARE_FRAUD_WARNING } from '@/lib/payments/paymentShare'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export interface CardOnFile {
  last4: string | null
  cardType: string | null
}

export function buildFinalInvoiceEmail(input: {
  firstName: string | null
  jobName: string
  invoiceNumber: string | null
  amount: number
  details: PaymentDetailsRecord
  /** Signed card authorization already on file for this job, if any. */
  cardOnFile: CardOnFile | null
  /** The pay-details share link — the ONLY route to the bank details, so the
   *  caller must have minted one before building this email. */
  payDetailsLink: string
  /** Whether the invoice PDF is attached to this email. */
  pdfAttached: boolean
}): { subject: string; html: string; text: string } {
  const first = input.firstName?.trim() || 'there'
  const amount = money(input.amount)
  const invoiceLabel = input.invoiceNumber ? `invoice ${input.invoiceNumber}` : 'your final invoice'
  const subject = input.invoiceNumber
    ? `SirReel — final invoice ${input.invoiceNumber} · ${amount}`
    : `SirReel — your final invoice · ${amount}`
  const card = input.cardOnFile
  const cardDesc = card
    ? `the ${card.cardType ?? ''} card ending ····${card.last4 ?? '????'}`.replace(/\s+/g, ' ')
    : null

  // ── Plain-text alternative ────────────────────────────────────────
  const text = [
    `Hi ${first},`,
    '',
    `Your final invoice for ${input.jobName} is ready${input.invoiceNumber ? ` — ${invoiceLabel}` : ''}.`,
    `Amount due: ${amount}`,
    input.pdfAttached ? 'The invoice is attached to this email.' : '',
    '',
    'HOW TO PAY',
    '',
    '1. Bank transfer (ACH or wire) — no fee. Our details are here:',
    `   ${input.payDetailsLink}`,
    '   The page has our ACH and wire information and any forms your',
    '   accounts-payable team needs — you can share the link with them directly.',
    ...(input.details.zelleHandle && input.details.zelleName
      ? [
          '',
          '2. Zelle:',
          `   Zelle tag: ${input.details.zelleHandle}`,
          `   Recipient name to confirm: ${input.details.zelleName}`,
          '   Zelle limits are set by your bank — for larger invoices use ACH or wire.',
          `   Prefer to scan? The Zelle QR code is on our payment-details page: ${input.payDetailsLink}`,
        ]
      : []),
    '',
    card
      ? `${input.details.zelleHandle ? '3' : '2'}. Card on file: we hold your signed authorization for ${cardDesc}. Reply to this email and we will run it for ${amount} plus the card processing fee (up to 3%, where permitted).`
      : `${input.details.zelleHandle ? '3' : '2'}. Card: authorize one at ${CARD_AUTH_URL} — a processing fee of up to 3% applies, where permitted. Bank transfers have no fee.`,
    '',
    `IMPORTANT: ${SHARE_FRAUD_WARNING}`,
    '',
    'Questions? Reply to this email or call (888) 477-7335.',
    '',
    'SirReel Studio Services',
  ]
    .filter((l) => l !== null)
    .join('\n')

  // ── HTML ──────────────────────────────────────────────────────────
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f2;">
  <div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="background:${SLATE};padding:24px 28px;border-bottom:3px solid ${GOLD};">
      <img src="${LOGO_URL_WHITE}" alt="SirReel Studio Services" style="height:28px;width:auto;display:block;border:0;" />
    </div>
    <div style="background:#ffffff;padding:28px;">
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Hi ${escapeHtml(first)},</p>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;">
        Your final invoice for <strong>${escapeHtml(input.jobName)}</strong> is ready${input.invoiceNumber ? ` &mdash; ${escapeHtml(invoiceLabel)}` : ''}.${input.pdfAttached ? ' It is attached to this email.' : ''}
      </p>

      <!-- amount banner -->
      <div style="border:1px solid #e5e2d9;border-radius:10px;overflow:hidden;margin:0 0 24px;">
        <div style="background:${SLATE};height:4px;line-height:4px;font-size:0;">&nbsp;</div>
        <div style="padding:18px 20px;background:#faf9f6;text-align:center;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:${GOLD};margin:0 0 6px;">Amount due</div>
          <div style="font-size:28px;font-weight:800;color:#111827;">${amount}</div>
        </div>
      </div>

      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:#6b7280;margin:0 0 12px;">How to pay</div>

      <!-- bank transfer: link-only, never numbers — see file header -->
      <div style="border:1px solid #e5e2d9;border-radius:10px;overflow:hidden;margin:0 0 16px;">
        <div style="padding:18px 20px;background:#faf9f6;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:${GOLD};margin:0 0 4px;">Bank transfer (ACH or wire)</div>
          <div style="font-size:12px;color:#6b7280;margin:0 0 12px;">No fee.</div>
          <a href="${input.payDetailsLink}" style="display:inline-block;background:${SLATE};color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;">View payment details &rarr;</a>
          <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#6b7280;">
            The page has our ACH and wire information and any forms your
            accounts-payable team needs &mdash; you can share the link with them directly.
          </p>
        </div>
      </div>

      ${
        input.details.zelleHandle && input.details.zelleName
          ? `<div style="border:1px solid #e5e2d9;border-radius:10px;padding:16px 18px;margin:0 0 16px;background:#ffffff;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:${GOLD};margin:0 0 10px;">Zelle</div>
        <div style="font-size:13px;line-height:1.7;color:#111827;">
          <div><strong>Zelle tag:</strong> ${escapeHtml(input.details.zelleHandle)}</div>
          <div><strong>Confirm the name:</strong> ${escapeHtml(input.details.zelleName)}</div>
          <div style="color:#6b7280;font-size:12px;margin-top:6px;">
            Your bank shows the recipient name before you send &mdash; check it matches.
            Zelle limits are set by your bank, so use ACH or wire for larger invoices.
          </div>
          <div style="font-size:12px;margin-top:8px;">
            Prefer to scan? <a href="${input.payDetailsLink}" style="color:${SLATE};font-weight:700;">The Zelle QR code is on our payment-details page</a>.
          </div>
        </div>
      </div>`
          : ''
      }

      <!-- card -->
      <div style="border:1px solid #e5e2d9;border-radius:10px;padding:16px 18px;margin:0 0 20px;background:#faf9f6;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:${GOLD};margin:0 0 8px;">Card</div>
        ${
          card
            ? `<p style="margin:0;font-size:13px;line-height:1.6;color:#374151;">
          We hold your signed authorization for <strong>${escapeHtml(cardDesc ?? '')}</strong>.
          Reply to this email and we will charge it for ${amount} plus the card
          processing fee (up to 3%, where permitted).
        </p>`
            : `<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#374151;">
          A processing fee of up to 3% applies to card payments, where permitted.
          Bank transfers have no fee.
        </p>
        <a href="${CARD_AUTH_URL}" style="display:inline-block;background:${SLATE};color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;">Authorize a card &rarr;</a>`
        }
      </div>

      <!-- fraud warning -->
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 20px;">
        <tr>
          <td style="width:5px;background:#c2410c;border-radius:8px 0 0 8px;">&nbsp;</td>
          <td style="background:#fff7ed;border:1px solid #fdba74;border-left:none;border-radius:0 8px 8px 0;padding:14px 16px;">
            <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#c2410c;margin:0 0 4px;">⚠ Fraud warning</div>
            <div style="font-size:13px;line-height:1.6;color:#7c2d12;">${escapeHtml(SHARE_FRAUD_WARNING)}</div>
          </td>
        </tr>
      </table>

      <p style="margin:20px 0 4px;font-size:14px;line-height:1.6;">Questions? Reply to this email or call <a href="tel:+18884777335" style="color:${SLATE};font-weight:700;text-decoration:none;">(888) 477-7335</a>.</p>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">SirReel Studio Services</p>
    </div>
  </div>
</body></html>`

  return { subject, html, text }
}
