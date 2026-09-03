/**
 * Render + store the client-facing Quote PDF for an Order.
 *
 * Lifted out of the POST route on 2026-09-01 so the route is no longer the
 * only way a PDF gets cut. Wes: "can we make it so that when a quote is
 * modified and saved in HQ, the PDF is auto-regenerated?" — the answer is
 * yes, but a rep edits an order one line at a time, so re-rendering inside
 * every line-item write would put ~0.5-1.2s on each save and cut a dozen
 * PDFs for one afternoon's work. Instead this is callable from anywhere,
 * and `ensureFreshQuotePdf` below re-cuts on the two events that actually
 * matter: somebody is about to LOOK at the PDF, or SEND it.
 *
 * Replace-on-regenerate: the previous blob is deleted after the Order row
 * points at the new one, so an order carries exactly one quote PDF.
 *
 * Measured render cost: 250-420ms for a 6-line order, ~650ms for 54 lines.
 */

import { randomUUID } from 'crypto'
import { put, del } from '@vercel/blob'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React from 'react'
import { prisma } from '@/lib/prisma'
import { QuoteDocument, type Department, type QuoteLineItem } from '@/lib/sales/QuoteDocument'
import { catalogClientCode } from '@/lib/catalog/display'
import { isQuotePdfStale } from '@/lib/orders/quotePdfFreshness'
import { buildBookingTerms, type BookingVehicleLine } from '@/lib/sales/bookingTerms'

export type GenerateQuotePdfResult =
  | { ok: true; url: string; key: string; generatedAt: Date }
  | { ok: false; status: number; error: string }

export async function generateQuotePdf(orderId: string): Promise<GenerateQuotePdfResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      company: true,
      agent: true,
      job: true,
      jobContact: true,
      lineItems: {
        include: {
          inventoryItem: { select: { code: true, rwICode: true, trackingMode: true } },
          // Booking-details input ONLY — see the bookingTerms block below.
          // A line with any sub-rental is fulfilled by a partner's unit and
          // can never carry LCDW. `select: { id: true }` deliberately: this
          // must answer "is there one" and nothing else, so no vendor name,
          // cost or PO can reach a client-facing render through it.
          subRentals: { select: { id: true } },
        },
        orderBy: { sortOrder: 'asc' },
      },
      // Structured discounts (OrderDiscount). Passed to QuoteDocument
      // which renders dept discount lines under each section subtotal
      // and the order discount in the totals block.
      discounts: true,
    },
  })
  if (!order) return { ok: false, status: 404, error: 'Order not found' }
  if (order.lineItems.length === 0) {
    return { ok: false, status: 400, error: 'Order has no line items' }
  }

  // CLIENT-FACING — sub-rental fields (vendor name, vendor cost, PO #,
  // status, receiveMethod) must NEVER be added to this serializer. The
  // quote shows the client what they're paying, not where SirReel
  // sourced it from. Internal sub-rental surfaces read OrderLineItem
  // .subRentals directly and never come through this DTO.
  const lineItems: QuoteLineItem[] = order.lineItems.map((li) => ({
    department: li.department as Department,
    description: li.description,
    qualifier: li.qualifier,
    inventoryCode: catalogClientCode(li),
    quantity: li.quantity,
    rate: Number(li.rate),
    rateType: li.rateType as 'DAILY' | 'WEEKLY' | 'FLAT',
    pickupDate: li.pickupDate,
    returnDate: li.returnDate,
    billableDays: li.billableDays,
    computedDays: li.computedDays ?? null,
    lineTotal: Number(li.lineTotal),
    id: li.id,
    // A partner ancillary hangs under the unit it belongs to, so it renders
    // inside that unit's section rather than being hoisted into "Fees".
    parentLineItemId: li.parentLineItemId ?? null,
    // Included accessory — prints "Included" instead of $0.00 so the
    // client can see what they are responsible for bringing back.
    isIncludedAccessory: !!li.autoKitPieceId,
    isDiscount: li.type === 'DISCOUNT',
    // Fee-catalog lines render in their own "Fees" section (last), UNLESS
    // they belong to a parent line — see groupByDepartment.
    isFee: li.type === 'FEE',
    // Client-facing note (e.g. LED Wall A/V Tech requirement, seeded
    // from InventoryItem.clientNote at line-add time). Prints italic
    // under the description on the quote PDF.
    notes: li.notes,
  }))

  // Booking details (lot hours, rental cycle, mileage, LCDW, cancellation,
  // card fee). Resolved HERE rather than inside QuoteDocument because the
  // LCDW half has to know which lines are partner-fulfilled, and that fact
  // must not travel in the client-facing line-item DTO above — see the
  // CLIENT-FACING warning on it. What crosses into the render is the
  // finished sentence, never the sub-rental.
  const bookingTerms = buildBookingTerms({
    vehicles: order.lineItems
      .filter((li) => li.department === 'VEHICLES' && li.type !== 'DISCOUNT')
      .map<BookingVehicleLine>((li) => ({
        description: li.description,
        code: li.inventoryItem?.code ?? null,
        isPartnerVehicle: li.subRentals.length > 0,
      })),
  })

  const contactFullName = order.jobContact
    ? `${order.jobContact.firstName} ${order.jobContact.lastName}`.trim()
    : null

  let pdfBytes: Buffer
  try {
    const element = React.createElement(QuoteDocument, {
      orderNumber: order.orderNumber,
      description: order.description,
      notes: order.notes,
      subtotal: Number(order.subtotal),
      taxRate: Number(order.taxRate),
      taxAmount: Number(order.taxAmount),
      total: Number(order.total),
      quoteExpDays: order.quoteExpDays,
      lineItems,
      discounts: order.discounts.map((d) => ({
        scope: d.scope,
        departmentKey: d.departmentKey as Department | null,
        type: d.type,
        value: Number(d.value),
        label: d.label,
      })),
      company: {
        name: order.company.name,
        billingAddress: order.company.billingAddress,
        billingEmail: order.company.billingEmail,
      },
      jobContact: order.jobContact
        ? {
            fullName: contactFullName,
            email: order.jobContact.email,
            phone: order.jobContact.phone ?? order.jobContact.mobile ?? null,
          }
        : null,
      agent: {
        name: order.agent.name,
        email: order.agent.email,
        phone: order.agent.phone ?? null,
      },
      job: order.job
        ? { jobCode: order.job.jobCode, name: order.job.name }
        : null,
      bookingTerms,
      generatedAt: new Date(),
    }) as React.ReactElement<DocumentProps>
    pdfBytes = await renderToBuffer(element)
  } catch (err) {
    console.error('[quote-pdf] render error:', err)
    return { ok: false, status: 500, error: 'Failed to render quote PDF. See server logs.' }
  }

  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `quotes/${yyyy}/${mm}/${randomUUID()}-${order.orderNumber}.pdf`

  let blob
  try {
    blob = await put(blobKey, pdfBytes, {
      access: 'private' as 'public', // @vercel/blob types only expose 'public' but private buckets accept the same call
      contentType: 'application/pdf',
    })
  } catch (err) {
    console.error('[quote-pdf] blob upload error:', err)
    return { ok: false, status: 500, error: 'Failed to upload quote PDF.' }
  }

  const previousKey = order.quotePdfKey
  await prisma.order.update({
    where: { id: order.id },
    data: {
      quotePdfKey: blobKey,
      quotePdfUrl: blob.url,
      quotePdfGeneratedAt: now,
    },
  })

  if (previousKey && previousKey !== blobKey) {
    try {
      await del(previousKey)
    } catch (err) {
      console.warn('[quote-pdf] failed to delete prior blob (non-fatal):', err)
    }
  }

  return { ok: true, url: blob.url, key: blobKey, generatedAt: now }
}

/**
 * Re-cut the stored PDF when the order has moved since it was rendered.
 *
 * Deliberately does NOT create a first PDF: an order with no quote PDF has
 * never been quoted, and generating one on a read would cut documents for
 * every DRAFT anybody opens. Missing stays missing — callers already handle
 * that case with their own message.
 *
 * Never throws. A regeneration failure leaves the existing PDF in place and
 * is reported to the caller, because serving yesterday's quote beats
 * serving a 500 — the staleness banner still tells the truth.
 */
export async function ensureFreshQuotePdf(
  orderId: string,
): Promise<{ regenerated: boolean; key?: string; url?: string; error?: string }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      quotePdfKey: true,
      quotePdfGeneratedAt: true,
      updatedAt: true,
      lineItems: { select: { updatedAt: true } },
      discounts: { select: { updatedAt: true } },
    },
  })
  if (!order?.quotePdfKey) return { regenerated: false }
  if (!isQuotePdfStale(order)) return { regenerated: false }

  try {
    const res = await generateQuotePdf(orderId)
    if (!res.ok) {
      console.warn('[quote-pdf] auto-refresh failed (serving prior PDF):', res.error)
      return { regenerated: false, error: res.error }
    }
    // Callers holding an `order` row read BEFORE this call have the old
    // key in hand, and the old blob has just been deleted — send-quote
    // fetches the attachment by key, so it must use this one.
    return { regenerated: true, key: res.key, url: res.url }
  } catch (err) {
    console.warn('[quote-pdf] auto-refresh threw (serving prior PDF):', err)
    return { regenerated: false, error: 'regeneration failed' }
  }
}
