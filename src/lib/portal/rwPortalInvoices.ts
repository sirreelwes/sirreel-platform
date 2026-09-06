/**
 * RentalWorks invoices as the account portal shows them.
 *
 * RW is still the billing source of truth for most shows, and the portal
 * used to read only HQ-native Invoice rows — so every RW-billed job said
 * "Not yet invoiced" (2026-09-05, CMS: six RW invoices, zero visible). The
 * bridge is JobRwOrder: a staff member links an RW ORDER to a job, and every
 * non-void invoice on that order becomes the job's. Nothing here matches on
 * customer names; the human link is the attribution.
 *
 * Money shown is the invoice total and what remains — never a line item.
 * "Paid" honours HQ's own paid marks (RwInvoicePaidMark) because RW lags
 * reality when a card is run from HQ.
 */

import { prisma } from '@/lib/prisma'
import { RW_VOID, getHqPaidInvoiceIds } from '@/lib/rentalworks/arStatus'

export interface RwPortalInvoice {
  rwInvoiceId: string
  invoiceNumber: string
  orderNumber: string
  invoiceDate: Date | null
  dueDate: Date | null
  total: number
  received: number
  remaining: number
  /** Nothing left to collect — RW says so, or HQ marked it paid. */
  paid: boolean
}

function n(v: { toString(): string } | number | null | undefined): number {
  return v == null ? 0 : Number(v.toString())
}

/** Invoices keyed by RW order number, for the given linked order numbers. */
export async function loadRwPortalInvoices(
  orderNumbers: string[],
): Promise<Map<string, RwPortalInvoice[]>> {
  const out = new Map<string, RwPortalInvoice[]>()
  const numbers = [...new Set(orderNumbers.filter(Boolean))]
  if (numbers.length === 0) return out
  const [rows, hqPaid] = await Promise.all([
    prisma.rwInvoice.findMany({
      where: { orderNumber: { in: numbers }, status: { not: RW_VOID } },
      orderBy: { invoiceDate: 'desc' },
      select: {
        rwInvoiceId: true,
        invoiceNumber: true,
        orderNumber: true,
        invoiceDate: true,
        dueDate: true,
        invoiceTotal: true,
        receivedTotal: true,
        remainingTotal: true,
      },
    }),
    getHqPaidInvoiceIds(),
  ])
  const paidSet = new Set(hqPaid)
  for (const r of rows) {
    const total = n(r.invoiceTotal)
    // RW's zero-total adjustment stubs (403724A-style) are bookkeeping,
    // not something a client should see as an invoice.
    if (Math.abs(total) < 0.005 || !r.orderNumber) continue
    const remaining = paidSet.has(r.rwInvoiceId) ? 0 : Math.max(0, n(r.remainingTotal))
    const inv: RwPortalInvoice = {
      rwInvoiceId: r.rwInvoiceId,
      invoiceNumber: r.invoiceNumber ?? r.rwInvoiceId,
      orderNumber: r.orderNumber,
      invoiceDate: r.invoiceDate,
      dueDate: r.dueDate,
      total,
      received: paidSet.has(r.rwInvoiceId) ? total : n(r.receivedTotal),
      remaining,
      paid: remaining < 0.005,
    }
    const list = out.get(r.orderNumber) ?? []
    list.push(inv)
    out.set(r.orderNumber, list)
  }
  return out
}
