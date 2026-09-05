/**
 * Final-invoice payment-options email — sent when an agent records a final
 * invoice on the job page, so the client hears "here's the number, here's how
 * to pay" the moment the number exists rather than when Ana reaches them on
 * the phone.
 *
 * THE COPY IS ANA'S. Wes, 2026-09-05, pasted the email she had been sending
 * by hand ("Hope everything went smoothly during your rental! Here's the
 * final invoice for the Puma x ASSC project...") and asked for the process
 * to be automated. Every paragraph of hers is here in order — the card on
 * file and the 3% fee, ACH/check to avoid it, the 3-business-day window, the
 * Loss & Damage inspection notice, the W-9 link, "let us know if this is good
 * to charge" — and the one thing that changed is that "let us know" is now
 * two buttons that record the answer on the invoice (see
 * lib/collections/invoiceReply.ts) instead of a reply Ana has to read.
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
import {
  BANK_WINDOW_BUSINESS_DAYS,
  describeCard,
  W9_URL,
  type OfferedCard,
} from '@/lib/collections/invoiceReply'

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

/** Kept as the name the callers import; the shape lives with the resolver. */
export type CardOnFile = OfferedCard

export function buildFinalInvoiceEmail(input: {
  firstName: string | null
  jobName: string
  invoiceNumber: string | null
  amount: number
  details: PaymentDetailsRecord
  /** The card we hold for this project, from either store, if any. */
  cardOnFile: CardOnFile | null
  /** The pay-details share link — the ONLY route to the bank details, so the
   *  caller must have minted one before building this email. */
  payDetailsLink: string
  /** Whether the invoice PDF is attached to this email. */
  pdfAttached: boolean
  /** The two answer buttons (lib/collections/invoiceReply.ts). `card` is
   *  only rendered when a card is on file. */
  replyLinks: { card: string; bank: string }
  /** "Wednesday, September 9" — the day the bank window closes. */
  bankDueBy: string
}): { subject: string; html: string; text: string } {
  const first = input.firstName?.trim() || 'there'
  const amount = money(input.amount)
  const subject = input.invoiceNumber
    ? `SirReel — final invoice ${input.invoiceNumber} for ${input.jobName} · ${amount}`
    : `SirReel — final invoice for ${input.jobName} · ${amount}`
  const card = input.cardOnFile
  const cardDesc = card ? describeCard(card) : null
  const window = `${BANK_WINDOW_BUSINESS_DAYS} business days`

  const intro = `Hope everything went smoothly during your rental! Here's the final invoice for the ${input.jobName} project${
    input.invoiceNumber ? ` (invoice ${input.invoiceNumber})` : ''
  }.${input.pdfAttached ? ' It is attached to this email.' : ''}`

  const ldNotice =
    'Be advised, our Loss & Damage department is still doing a final inspection of all items. ' +
    'If any L&D turns up, we will follow up with an invoice for the missing or damaged items.'

  // ── Plain-text alternative ────────────────────────────────────────
  const text = [
    `Hi ${first},`,
    '',
    intro,
    `Amount due: ${amount}`,
    '',
    'Please let us know if you have any questions on the invoice.',
    '',
    ...(card
      ? [
          `We have ${cardDesc} on file for this project. Please confirm if we're approved to charge the credit card (a 3% processing fee will apply), or if you prefer to pay via ACH or check to avoid the fee.`,
          '',
          `  Yes, charge the card:      ${input.replyLinks.card}`,
          `  I'll pay by ACH or check:  ${input.replyLinks.bank}`,
        ]
      : [
          `There is no card on file for this project. You can pay by ACH or check with no fee, or authorize a card (a 3% processing fee will apply).`,
          '',
          `  I'll pay by ACH or check:  ${input.replyLinks.bank}`,
          `  Authorize a card:          ${CARD_AUTH_URL}`,
        ]),
    '',
    `ACH or check payments must be submitted within ${window} (by ${input.bankDueBy}) so we can close out the project.`,
    '',
    'BANK TRANSFER (ACH or wire) — no fee. Our details are here:',
    `   ${input.payDetailsLink}`,
    '   The page has our ACH and wire information and any forms your',
    '   accounts-payable team needs — you can share the link with them directly.',
    ...(input.details.zelleHandle && input.details.zelleName
      ? [
          '',
          'ZELLE:',
          `   Zelle tag: ${input.details.zelleHandle}`,
          `   Recipient name to confirm: ${input.details.zelleName}`,
          '   Zelle limits are set by your bank — for larger invoices use ACH or wire.',
        ]
      : []),
    '',
    ldNotice,
    '',
    `SirReel W-9: ${W9_URL}`,
    '',
    `IMPORTANT: ${SHARE_FRAUD_WARNING}`,
    '',
    card ? 'Please let us know if this is good to charge!' : 'Please let us know how you would like to pay!',
    '',
    'Questions? Reply to this email or call (888) 477-7335.',
    '',
    'Thanks!',
    'SirReel Studio Services',
  ].join('\n')

  // ── HTML ──────────────────────────────────────────────────────────
  const button = (href: string, label: string, filled: boolean) =>
    filled
      ? `<a href="${href}" style="display:inline-block;background:${SLATE};color:#ffffff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;margin:0 8px 8px 0;">${label}</a>`
      : `<a href="${href}" style="display:inline-block;background:#ffffff;color:${SLATE};border:1px solid ${SLATE};padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px;margin:0 8px 8px 0;">${label}</a>`

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f2;">
  <div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="background:${SLATE};padding:24px 28px;border-bottom:3px solid ${GOLD};">
      <img src="${LOGO_URL_WHITE}" alt="SirReel Studio Services" style="height:28px;width:auto;display:block;border:0;" />
    </div>
    <div style="background:#ffffff;padding:28px;">
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Hi ${escapeHtml(first)},</p>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;">
        Hope everything went smoothly during your rental! Here&rsquo;s the final invoice for the
        <strong>${escapeHtml(input.jobName)}</strong> project${
          input.invoiceNumber ? ` (invoice ${escapeHtml(input.invoiceNumber)})` : ''
        }.${input.pdfAttached ? ' It is attached to this email.' : ''}
      </p>

      <!-- amount banner -->
      <div style="border:1px solid #e5e2d9;border-radius:10px;overflow:hidden;margin:0 0 20px;">
        <div style="background:${SLATE};height:4px;line-height:4px;font-size:0;">&nbsp;</div>
        <div style="padding:18px 20px;background:#faf9f6;text-align:center;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;color:${GOLD};margin:0 0 6px;">Amount due</div>
          <div style="font-size:28px;font-weight:800;color:#111827;">${amount}</div>
        </div>
      </div>

      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;">Please let us know if you have any questions on the invoice.</p>

      <!-- the question, with its two answers -->
      <div style="border:1px solid #e5e2d9;border-radius:10px;padding:18px 20px;margin:0 0 16px;background:#faf9f6;">
        ${
          card
            ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#111827;">
          We have <strong>${escapeHtml(cardDesc ?? '')}</strong> on file for this project. Please confirm
          if we&rsquo;re approved to charge the credit card (a 3% processing fee will apply), or if you
          prefer to pay via ACH or check to avoid the fee.
        </p>
        <div>
          ${button(input.replyLinks.card, 'Yes, charge the card &rarr;', true)}
          ${button(input.replyLinks.bank, 'I&rsquo;ll pay by ACH or check', false)}
        </div>`
            : `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#111827;">
          There is no card on file for this project. You can pay by ACH or check with no fee, or
          authorize a card (a 3% processing fee will apply).
        </p>
        <div>
          ${button(input.replyLinks.bank, 'I&rsquo;ll pay by ACH or check &rarr;', true)}
          ${button(CARD_AUTH_URL, 'Authorize a card', false)}
        </div>`
        }
        <p style="margin:6px 0 0;font-size:12px;line-height:1.6;color:#6b7280;">
          ACH or check payments must be submitted within ${window}
          (by <strong>${escapeHtml(input.bankDueBy)}</strong>) so we can close out the project.
        </p>
      </div>

      <!-- bank transfer: link-only, never numbers — see file header -->
      <div style="border:1px solid #e5e2d9;border-radius:10px;overflow:hidden;margin:0 0 16px;">
        <div style="padding:16px 20px;background:#ffffff;">
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
        </div>
      </div>`
          : ''
      }

      <!-- Loss & Damage notice — Ana's paragraph, verbatim in spirit -->
      <p style="margin:20px 0 16px;font-size:13px;line-height:1.6;color:#374151;">
        Be advised, our Loss &amp; Damage department is still doing a final inspection of all
        items. If any L&amp;D turns up, we will follow up with an invoice for the missing or
        damaged items.
      </p>

      <p style="margin:0 0 20px;font-size:13px;line-height:1.6;color:#374151;">
        SirReel W-9: <a href="${W9_URL}" style="color:${SLATE};font-weight:700;">${W9_URL}</a>
      </p>

      <!-- fraud warning -->
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 20px;">
        <tr>
          <td style="width:5px;background:#c2410c;border-radius:8px 0 0 8px;">&nbsp;</td>
          <td style="background:#fff7ed;border:1px solid #fdba74;border-left:none;border-radius:0 8px 8px 0;padding:14px 16px;">
            <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#c2410c;margin:0 0 4px;">Fraud warning</div>
            <div style="font-size:13px;line-height:1.6;color:#7c2d12;">${escapeHtml(SHARE_FRAUD_WARNING)}</div>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 4px;font-size:14px;line-height:1.6;">
        ${card ? 'Please let us know if this is good to charge!' : 'Please let us know how you would like to pay!'}
      </p>
      <p style="margin:12px 0 4px;font-size:14px;line-height:1.6;">Questions? Reply to this email or call <a href="tel:+18884777335" style="color:${SLATE};font-weight:700;text-decoration:none;">(888) 477-7335</a>.</p>
      <p style="margin:16px 0 0;font-size:14px;line-height:1.6;">Thanks!</p>
      <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">SirReel Studio Services</p>
    </div>
  </div>
</body></html>`

  return { subject, html, text }
}
