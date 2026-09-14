/**
 * "<client> paid <amount>" — the desk's heads-up that a client paid through
 * their own portal.
 *
 * Ana, 2026-09-14: *"a notification sent to me if client pays through the
 * portal. That way I can keep track of payments easier."*
 *
 * Before this, a portal payment was silent. The money landed, the invoice
 * reconciled itself, and the only way to find out was to go looking — so a
 * client who paid on Saturday could still be chased on Monday. (See
 * [[project-collections-remittance]] for the other half of that problem.)
 *
 * The email answers the four things the desk does next: who paid, how much,
 * against which invoice, and whether anything is still owed on it. The
 * balance line is the one that decides whether this invoice leaves the chase
 * list or stays on it, so it is a callout rather than a table row.
 */

import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from './shell'

export interface PortalPaymentEmailInput {
  /** Who clicked pay, off their portal access. */
  paidByName: string | null
  paidByEmail: string | null
  companyName: string | null
  jobName: string | null
  orderNumber: string | null
  invoiceNumber: string
  /** Credited to the invoice — never includes the card surcharge. */
  amount: number
  surcharge: number | null
  /** 'CARD' settles instantly; 'ACH' is initiated and days from landing. */
  kind: 'CARD' | 'ACH'
  /** Card last four / bank account last four, when we have it. */
  reference: string | null
  balanceDue: number
  paidInFull: boolean
  at: Date
  invoiceLink: string
}

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtWhen = (d: Date) =>
  d.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

export function buildPortalPaymentEmail(i: PortalPaymentEmailInput) {
  const who = i.paidByName || i.paidByEmail || 'A client'
  const account = i.companyName || i.jobName || 'a client'

  // ACH is money PROMISED, card is money TAKEN. Saying "paid" for both would
  // put an invoice on the cleared pile days before the bank agrees — the
  // same confusion remittance-vs-collected exists to prevent.
  const verb = i.kind === 'CARD' ? 'paid' : 'started an ACH payment of'
  const subject =
    i.kind === 'CARD'
      ? `${account} paid ${usd(i.amount)} — invoice ${i.invoiceNumber}`
      : `${account} started an ACH payment of ${usd(i.amount)} — invoice ${i.invoiceNumber}`

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Invoice', value: i.invoiceNumber },
    { label: 'Amount', value: usd(i.amount) },
  ]
  if (i.surcharge && i.surcharge > 0) {
    rows.push({ label: 'Card fee', value: `${usd(i.surcharge)} charged on top` })
  }
  rows.push({ label: 'Method', value: i.kind === 'CARD' ? `Card${i.reference ? ` ${i.reference}` : ''}` : `ACH${i.reference ? ` ${i.reference}` : ''}` })
  if (i.jobName) rows.push({ label: 'Job', value: i.jobName })
  if (i.orderNumber) rows.push({ label: 'Order', value: i.orderNumber })
  rows.push({ label: 'Paid by', value: [i.paidByName, i.paidByEmail].filter(Boolean).join(' · ') || '—' })
  rows.push({ label: 'When', value: fmtWhen(i.at) })

  const balanceNote = i.paidInFull
    ? '<strong>Paid in full.</strong> Nothing left on this invoice.'
    : `<strong>${usd(i.balanceDue)}</strong> still owed on this invoice.`

  const achNote =
    i.kind === 'ACH'
      ? p(
          'This is an ACH origination, not cleared money — it is recorded as pending ' +
            'and walks forward to cleared (or returned) on its own. Do not mark the ' +
            'invoice settled off this email.',
        )
      : ''

  const bodyHtml = [
    p(`${who} ${verb} ${usd(i.amount)} through the client portal.`),
    detailTable(rows),
    calloutBox(balanceNote),
    achNote,
  ].join('')

  const html = renderEmailShell({
    heading: i.kind === 'CARD' ? 'Payment received' : 'ACH payment started',
    eyebrow: 'Collections',
    preheader: `${account} — ${usd(i.amount)} on invoice ${i.invoiceNumber}`,
    bodyHtml,
    cta: { label: 'Open the invoice', href: i.invoiceLink },
  })

  const text = renderEmailText([
    `${who} ${verb} ${usd(i.amount)} through the client portal.`,
    '',
    `Invoice: ${i.invoiceNumber}`,
    `Amount: ${usd(i.amount)}${i.surcharge && i.surcharge > 0 ? ` (+ ${usd(i.surcharge)} card fee)` : ''}`,
    `Method: ${i.kind === 'CARD' ? 'Card' : 'ACH'}${i.reference ? ` ${i.reference}` : ''}`,
    i.jobName ? `Job: ${i.jobName}` : '',
    i.orderNumber ? `Order: ${i.orderNumber}` : '',
    `Paid by: ${[i.paidByName, i.paidByEmail].filter(Boolean).join(' · ') || '—'}`,
    `When: ${fmtWhen(i.at)}`,
    '',
    i.paidInFull ? 'Paid in full.' : `${usd(i.balanceDue)} still owed on this invoice.`,
    i.kind === 'ACH'
      ? 'ACH origination — pending, not cleared money. Do not mark the invoice settled off this email.'
      : '',
    '',
    i.invoiceLink,
  ].filter(Boolean))

  return { subject, html, text }
}
