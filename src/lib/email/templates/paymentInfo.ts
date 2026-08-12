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
import { SHARE_FRAUD_WARNING } from '@/lib/payments/paymentShare'

const GOLD = '#D4A547'
const SLATE = '#0f172a'

// Verbatim per ruling — do not edit without Wes.
/** Our own path, not the vendor URL — see legacyRedirects. When card
 *  authorization moves into the portal this follows automatically. */
const CARD_AUTH_URL = 'https://sirreel.com/creditcardauthorization'

/** Same asset the rest of the SirReel emails use. */
const LOGO_URL_WHITE = 'https://hq.sirreel.com/sirreel-logo-white.png'

/** Zelle QR, same host as the logo. Absolute because mail clients cannot
 *  resolve relative paths; the marketing host does not serve /payment/. */
const ZELLE_QR_URL = 'https://hq.sirreel.com/payment/zelle-qr.png'

export const FRAUD_WARNING =
  "SirReel's payment details never change. If you receive any notice of updated banking information, call (888) 477-7335 before sending funds."

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
  /**
   * Optional link to the same details on sirreel.com.
   *
   * The numbers stay in the email — the client should not have to click
   * anything to pay us. The link is the ANCHOR: if this thread is later
   * followed by a "our banking details have changed" message, the payer has
   * somewhere authoritative to check that an attacker cannot rewrite. That
   * is the fraud this defends against, and it only works if the payer knows
   * the anchor exists before the fraudulent message arrives.
   */
  verifyLink?: string | null
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
    ...(input.details.zelleHandle && input.details.zelleName
      ? [
          '',
          'Paying by Zelle:',
          `  Zelle tag: ${input.details.zelleHandle}`,
          `  Recipient name to confirm: ${input.details.zelleName}`,
          // The tag alone is not enough to send safely — the payer confirms
          // the recipient NAME in their banking app, and that is the check
          // that catches a wrong or spoofed tag.
          '  Zelle limits are set by your bank and are often a few thousand',
          '  dollars per day — for larger invoices use ACH or wire above.',
        ]
      : []),
    '',
    `IMPORTANT: ${FRAUD_WARNING}`,
    ...(input.verifyLink
      ? ['', `You can always confirm these details here: ${input.verifyLink}`]
      : []),
    '',
    // The client asked how to pay us; answering with bank details alone
    // presents ACH as the only option and quietly decides for them. Card is
    // a real choice — with a real cost, stated here rather than discovered
    // on the statement.
    'Prefer to pay by card? Authorize one here:',
    CARD_AUTH_URL,
    'A processing fee of up to 3% applies to card payments, where permitted.',
    'Bank transfers have no fee.',
    '',
    'Questions? Reply to this email or call (888) 477-7335.',
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
      <!-- Real mark, matching every other SirReel email (thankYou,
           tsxWelcome, bookingWelcome, stageSignedConfirmation). This header
           was set in type, so the one email that hands a client our banking
           details was the one that looked least like us — exactly the email
           where looking authentically like SirReel matters most.

           Absolute URL on hq.sirreel.com: mail clients cannot resolve
           relative paths, and the host serves /sirreel-logo-white.png
           unauthenticated for this purpose (see middleware's allow-list).
           The alt text carries the brand for image-blocking clients. -->
      <img
        src="${LOGO_URL_WHITE}"
        alt="SirReel Studio Services"
        style="height:28px;width:auto;display:block;border:0;"
      />
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
      ${
        input.details.zelleHandle && input.details.zelleName
          ? `<div style="border:1px solid #e5e2d9;border-radius:10px;padding:16px 18px;margin:0 0 20px;background:#ffffff;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:${GOLD};margin:0 0 10px;">Or pay by Zelle</div>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="top" style="padding-right:16px;">
            <img src="${ZELLE_QR_URL}" alt="Zelle QR code" width="104" height="104" style="display:block;border:0;width:104px;height:104px;" />
          </td>
          <td valign="top" style="font-size:13px;line-height:1.7;color:#111827;">
            <div><strong>Zelle tag:</strong> ${escapeHtml(input.details.zelleHandle)}</div>
            <div><strong>Confirm the name:</strong> ${escapeHtml(input.details.zelleName)}</div>
            <div style="color:#6b7280;font-size:12px;margin-top:6px;">
              Your bank will show the recipient name before you send &mdash; check it matches.
              Zelle limits are set by your bank, so use ACH or wire for larger invoices.
            </div>
          </td>
        </tr></table>
      </div>`
          : ''
      }

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

      <div style="border:1px solid #e5e2d9;border-radius:10px;padding:16px 18px;margin:20px 0 0;background:#faf9f6;">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:${GOLD};margin:0 0 8px;">Prefer to pay by card?</div>
        <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#374151;">
          A processing fee of up to 3% applies to card payments, where permitted.
          Bank transfers have no fee.
        </p>
        <a href="${CARD_AUTH_URL}" style="display:inline-block;background:${SLATE};color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;">Authorize a card &rarr;</a>
      </div>

      <p style="margin:20px 0 4px;font-size:14px;line-height:1.6;">Questions? Reply to this email or call <a href="tel:+18884777335" style="color:${SLATE};font-weight:700;text-decoration:none;">(888) 477-7335</a>.</p>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">${payee ? escapeHtml(payee) : 'SirReel Studio Services'}</p>
    </div>
  </div>
</body></html>`

  return { subject, html, text }
}

/**
 * Link-only variant — what the public payment-info flow now sends.
 *
 * buildPaymentInfoEmail (above) inlines the full record and is kept for
 * reference and any operator-driven path that still needs it. It should not
 * be used for automated sends: a message carrying account numbers can be
 * forwarded through mailboxes SirReel cannot see, and the eventual reader
 * has no way to tell an altered copy from a real one. That is precisely the
 * gap invoice-redirect fraud exploits.
 */
export function buildPaymentLinkEmail(input: {
  firstName: string | null
  link: string
}): { subject: string; html: string; text: string } {
  const first = input.firstName?.trim() || 'there'
  const subject = 'SirReel — payment information'

  const text = [
    `Hi ${first},`,
    '',
    'As requested, our payment details are here:',
    input.link,
    '',
    'The page includes our ACH and wire information and any forms your',
    'accounts-payable team needs. You can share the link with them directly.',
    '',
    `IMPORTANT: ${SHARE_FRAUD_WARNING}`,
    '',
    'Questions: billing@sirreel.com',
    '',
    'SirReel Studio Services',
  ].join('\n')

  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;color:#1a1a1a">
      <p>Hi ${escapeHtml(first)},</p>
      <p>As requested, our payment details are here:</p>
      <p style="margin:22px 0">
        <a href="${input.link}" style="background:#1a1a1a;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">View payment details</a>
      </p>
      <p style="font-size:14px">The page includes our ACH and wire information and any
      forms your accounts-payable team needs. You can share the link with them directly.</p>
      <p style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:11px 13px;font-size:13px;color:#78350f">
        <strong>${escapeHtml(SHARE_FRAUD_WARNING)}</strong>
      </p>
      <p style="font-size:13px;color:#555">Questions: billing@sirreel.com</p>
      <p style="font-size:13px;color:#555">SirReel Studio Services</p>
    </div>`

  return { subject, html, text }
}
