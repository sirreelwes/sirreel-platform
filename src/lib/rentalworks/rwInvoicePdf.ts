/**
 * Render a RentalWorks invoice to PDF bytes — the one renderer behind both
 * the staff route (/api/rentalworks/invoices/[id]/pdf) and the account
 * portal's copy. Extracted 2026-09-05 so the client-facing route could not
 * drift from the desk's: same live-then-mirror fallback, same document.
 *
 * Live fetch deliberately bypasses rwFetch — see the staff route's history:
 * RW answers 401/403 on the per-record invoice GET for a session bearer the
 * browse endpoints accept, and rwFetch would read that as a dead credential.
 */

import { createElement } from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { prisma } from '@/lib/prisma'
import { RwInvoiceDocument, type RwInvoiceDetail } from '@/lib/rentalworks/RwInvoiceDocument'
import { readRwToken } from '@/lib/rentalworks/credential'

const RW_BASE = 'https://sirreel.rentalworks.cloud'

export const RW_INVOICE_ID_RE = /^[A-Za-z0-9]{4,20}$/

export async function loadRwInvoiceDetail(rwInvoiceId: string): Promise<RwInvoiceDetail | null> {
  const token = await readRwToken()
  if (token) {
    try {
      const r = await fetch(`${RW_BASE}/api/v1/invoice/${rwInvoiceId}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
      if (r.ok) return (await r.json()) as RwInvoiceDetail
      console.error(`[rw-invoice-pdf] live fetch ${rwInvoiceId} → HTTP ${r.status}; serving from mirror`)
    } catch {
      /* fall through to mirror */
    }
  }
  const m = await prisma.rwInvoice.findUnique({ where: { rwInvoiceId } })
  if (!m) return null
  return {
    InvoiceNumber: m.invoiceNumber ?? undefined,
    Status: m.status ?? undefined,
    InvoiceDate: m.invoiceDate?.toISOString(),
    InvoiceDueDate: m.dueDate?.toISOString(),
    Customer: m.customerName ?? undefined,
    PurchaseOrderNumber: m.poNumber ?? undefined,
    Deal: m.dealName ?? undefined,
    OrderNumber: m.orderNumber ?? undefined,
    OrderDescription: m.orderDescription ?? undefined,
    InvoiceDescription: m.invoiceDescription ?? undefined,
    BillingStartDate: m.billingStartDate?.toISOString(),
    BillingEndDate: m.billingEndDate?.toISOString(),
    Agent: m.agent ?? undefined,
    InvoiceSubTotal: Number(m.invoiceTotal),
    InvoiceTax: 0,
    InvoiceTotal: Number(m.invoiceTotal),
    ReceivedTotal: Number(m.receivedTotal),
    RemainingTotal: Number(m.remainingTotal),
  }
}

export async function renderRwInvoicePdf(inv: RwInvoiceDetail): Promise<Buffer> {
  const renderedAt = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  const element = createElement(RwInvoiceDocument, { inv, renderedAt }) as unknown as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}
