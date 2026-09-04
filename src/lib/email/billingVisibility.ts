/**
 * Billing's copy of client-facing invoice mail.
 *
 * Wes 2026-09-04: "when invoices are sent to clients — cc billing@".
 *
 * Invoice mail already REPLIES to billing@ (see sendInvoice /
 * sendPreInvoice / sendFinalInvoiceEmail), but that only catches a client
 * who writes back. The send itself was invisible: Ana had no way to see
 * that an invoice went out, to whom, or when, without opening HQ. The CC
 * puts the outbound copy — PDF and all — in the billing inbox at the
 * moment it leaves.
 *
 * Deliberately a notification channel rather than a constant, so the
 * audience is editable at /admin/notifications (an empty list turns the
 * copy off) and so a second billing person doesn't need a deploy.
 *
 * The client SEES this address on the CC line. That is intended: billing@
 * is already printed on the invoice PDF and is the Reply-To, so it is
 * nothing they weren't told to write to anyway.
 */

import { channelRecipients, dedupeEmails } from '@/lib/email/notificationChannels'

/**
 * Merge the invoice-billing audience into a CC list without duplicating
 * entries (case-insensitively) or shadowing the To recipient.
 *
 * Never throws — channelRecipients degrades to the channel default on a DB
 * hiccup, and the worst case here is an invoice that sends without the
 * copy, never an invoice that fails to send.
 */
export async function withBillingCc(
  existing: string[] = [],
  recipient?: string | null,
): Promise<string[]> {
  const billing = await channelRecipients('invoice-billing-cc')
  if (billing.length === 0) return dedupeEmails(existing)
  const merged = dedupeEmails([...existing, ...billing])
  const to = recipient?.trim().toLowerCase()
  return to ? merged.filter((e) => e.toLowerCase() !== to) : merged
}
