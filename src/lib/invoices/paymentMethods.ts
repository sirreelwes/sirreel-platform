/**
 * How an HQ invoice was paid — the words, and the list staff pick from.
 *
 * Ana, 2026-09-11: a way to mark HQ invoices paid by hand when the money
 * came by Zelle, wire or ACH, with the option to show HOW it was paid. The
 * Payment row always carried a method; nothing turned it into words, Zelle
 * was not one of them, and the order page printed the raw enum ("CREDIT_CARD").
 *
 * Client-safe on purpose (types only from Prisma): the collections list, the
 * order page and the PAID PDF all read these, and the first two are client
 * components.
 */

import type { PaymentMethod } from '@prisma/client'

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  ZELLE: 'Zelle',
  WIRE: 'Wire',
  ACH: 'ACH',
  CHECK: 'Check',
  CASH: 'Cash',
  CREDIT_CARD: 'Card',
  CARDPOINTE: 'CardPointe',
  OTHER: 'Other',
}

export function paymentMethodLabel(method: string): string {
  return (PAYMENT_METHOD_LABEL as Record<string, string>)[method] ?? method
}

/**
 * Money that arrives outside the gateway, in the order Ana named it. The card
 * methods are absent: a card is CHARGED from Collections, which records its
 * own Payment with the retref — marking a card paid by hand would be a
 * payment with no transaction behind it.
 */
export const MANUAL_PAYMENT_METHODS = ['ZELLE', 'WIRE', 'ACH', 'CHECK', 'CASH', 'OTHER'] as const satisfies readonly PaymentMethod[]

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number]

/** What the reference box should hold for each method. */
export const REFERENCE_HINT: Record<ManualPaymentMethod, string> = {
  ZELLE: 'Zelle confirmation #',
  WIRE: 'Wire / Fed reference #',
  ACH: 'ACH trace #',
  CHECK: 'Check #',
  CASH: 'Receipt # (optional)',
  OTHER: 'How it was paid',
}

/**
 * "Zelle", "Wire + Card" — the distinct ways an invoice's payments came in,
 * in the order given. Both card methods read "Card": to a client, and to the
 * person reading the row, a card is a card.
 */
export function paidViaLabel(methods: readonly string[]): string | null {
  const seen: string[] = []
  for (const m of methods) {
    const label = m === 'CARDPOINTE' ? 'Card' : paymentMethodLabel(m)
    if (!seen.includes(label)) seen.push(label)
  }
  return seen.length ? seen.join(' + ') : null
}

/** Today in Los Angeles as `YYYY-MM-DD` — the business day everywhere in HQ.
 *  (eodReport's pacificToday is the same function, but that module reads the
 *  database and cannot ride into a client bundle.) */
export function pacificTodayYmd(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '01'
  return `${get('year')}-${get('month')}-${get('day')}`
}
