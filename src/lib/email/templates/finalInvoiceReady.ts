/**
 * Final-invoice payment-options email — sent when an agent records a final
 * invoice on the job page, so the client hears "here's the number, here's how
 * to pay" the moment the number exists rather than when Ana reaches them on
 * the phone.
 *
 * SENSITIVE for the same reason as paymentInfo.ts: it carries banking
 * details. The standing ruling (Wes ruled A) is that details may be INLINED
 * when emailed to a resolved on-file address with a human gate. Both hold
 * here — the recipient is a JobContact on the invoiced job, and the gate is
 * the agent recording the invoice. Automated sends to anyone else must use
 * the link-only pattern instead (buildPaymentLinkEmail).
 *
 * Brand and blocks are composed from paymentInfo.ts exports — one source for
 * the details rows, the URLs, and the palette, so the two payment emails
 * cannot drift apart. FRAUD_WARNING is verbatim per ruling.
 *
 * Reply-To is billing@ — replies are "run my card" / "we're wiring Friday",
 * which is collections work, not the uploading agent's.
 */

import type { PaymentDetailsRecord } from '@/lib/payments/paymentDetails'
import {
  CARD_AUTH_URL,
  FRAUD_WARNING,
  GOLD,
  LOGO_URL_WHITE,
  SLATE,
  ZELLE_QR_URL,
  detailRows,
} from '@/lib/email/templates/paymentInfo'

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
  /** Anti-fraud anchor link (pay-details share). Best-effort. */
  verifyLink: string | null
  /** Whether the invoice PDF is attached to this email. */
  pdfAttached: boolean
}): { subject: string; html: string; text: string } {
  const first = input.firstName?.trim() || 'there'
  const amount = money(input.amount)
  const invoiceLabel = input.invoiceNumber ? `invoice ${input.invoiceNumber}` : 'your final invoice'
  const subject = input.invoiceNumber
    ? `SirReel — final invoice ${input.invoiceNumber} · ${amount}`
    : `SirReel — your final invoice · ${amount}`
  const rows = detailRows(input.details)
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
    '1. Bank transfer (ACH or wire) — no fee:',
    ...rows.map((r) => `   ${r.label}: ${r.value}`),
    ...(input.details.zelleHandle && input.details.zelleName
      ? [
          '',
          '2. Zelle:',
          `   Zelle tag: ${input.details.zelleHandle}`,
          `   Recipient name to confirm: ${input.details.zelleName}`,
          '   Zelle limits are set by your bank — for larger invoices use ACH or wire.',
        ]
      : []),
    '',
    card
      ? `${input.details.zelleHandle ? '3' : '2'}. Card on file: we hold your signed authorization for ${cardDesc}. Reply to this email and we will run it for ${amount} plus the card processing fee (up to 3%, where permitted).`
      : `${input.details.zelleHandle ? '3' : '2'}. Card: authorize one at ${CARD_AUTH_URL} — a processing fee of up to 3% applies, where permitted. Bank transfers have no fee.`,
    '',
    `IMPORTANT: ${FRAUD_WARNING}`,
    ...(input.verifyLink ? ['', `Confirm our payment details any time: ${input.verifyLink}`] : []),
    '',
    'Questions? Reply to this email or call (888) 477-7335.',
    '',
    'SirReel Studio Services',
  ]
    .filter((l) => l !== null)
    .join('\n')

  // ── HTML ──────────────────────────────────────────────────────────
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

      <!-- bank transfer -->
      <div style="border:1px solid #e5e2d9;border-radius:10px;overflow:hidden;margin:0 0 16px;">
        <div style="padding:18px 20px;background:#faf9f6;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:${GOLD};margin:0 0 4px;">Bank transfer (ACH or wire)</div>
          <div style="font-size:12px;color:#6b7280;margin:0 0 12px;">No fee.</div>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
            ${rowsHtml}
          </table>
        </div>
      </div>

      ${
        input.details.zelleHandle && input.details.zelleName
          ? `<div style="border:1px solid #e5e2d9;border-radius:10px;padding:16px 18px;margin:0 0 16px;background:#ffffff;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:${GOLD};margin:0 0 10px;">Zelle</div>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="top" style="padding-right:16px;">
            <img src="${ZELLE_QR_URL}" alt="Zelle QR code" width="104" height="104" style="display:block;border:0;width:104px;height:104px;" />
          </td>
          <td valign="top" style="font-size:13px;line-height:1.7;color:#111827;">
            <div><strong>Zelle tag:</strong> ${escapeHtml(input.details.zelleHandle)}</div>
            <div><strong>Confirm the name:</strong> ${escapeHtml(input.details.zelleName)}</div>
            <div style="color:#6b7280;font-size:12px;margin-top:6px;">
              Your bank shows the recipient name before you send &mdash; check it matches.
              Zelle limits are set by your bank, so use ACH or wire for larger invoices.
            </div>
          </td>
        </tr></table>
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
            <div style="font-size:13px;line-height:1.6;color:#7c2d12;">${escapeHtml(FRAUD_WARNING)}</div>
            ${
              input.verifyLink
                ? `<div style="font-size:13px;line-height:1.6;color:#7c2d12;margin-top:8px;">You can always confirm these details at <a href="${input.verifyLink}" style="color:#7c2d12;font-weight:700;">sirreel.com</a>.</div>`
                : ''
            }
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
