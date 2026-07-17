import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { randomUUID } from 'crypto'
import { put, del, get } from '@vercel/blob'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React from 'react'
import { prisma } from '@/lib/prisma'
import { QuoteDocument, type Department, type QuoteLineItem } from '@/lib/sales/QuoteDocument'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

// Generate the client-facing Quote PDF for an Order and persist its blob
// key/url on the Order. Mirrors the contract counter-PDF pattern:
// replace-on-regenerate (delete the previous blob), private bucket
// access, idempotent.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      company: true,
      agent: true,
      job: true,
      jobContact: true,
      lineItems: {
        include: {
          inventoryItem: { select: { code: true } },
        },
        orderBy: { sortOrder: 'asc' },
      },
      // Structured discounts (OrderDiscount). Passed to QuoteDocument
      // which renders dept discount lines under each section subtotal
      // and the order discount in the totals block.
      discounts: true,
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.lineItems.length === 0) {
    return NextResponse.json({ error: 'Order has no line items' }, { status: 400 })
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
    inventoryCode: li.inventoryItem?.code ?? null,
    quantity: li.quantity,
    rate: Number(li.rate),
    rateType: li.rateType as 'DAILY' | 'WEEKLY' | 'FLAT',
    pickupDate: li.pickupDate,
    returnDate: li.returnDate,
    billableDays: li.billableDays,
    computedDays: li.computedDays ?? null,
    lineTotal: Number(li.lineTotal),
    isDiscount: li.type === 'DISCOUNT',
    // Fee-catalog lines render in their own "Fees" section (last),
    // never mixed into the department groups.
    isFee: li.type === 'FEE',
    // Client-facing note (e.g. LED Wall A/V Tech requirement, seeded
    // from InventoryItem.clientNote at line-add time). Prints italic
    // under the description on the quote PDF.
    notes: li.notes,
  }))

  const contactFullName = order.jobContact
    ? `${order.jobContact.firstName} ${order.jobContact.lastName}`.trim()
    : null

  let pdfBytes: Buffer
  try {
    const element = React.createElement(QuoteDocument, {
      orderNumber: order.orderNumber,
      description: order.description,
      startDate: order.startDate,
      endDate: order.endDate,
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
      generatedAt: new Date(),
    }) as React.ReactElement<DocumentProps>
    pdfBytes = await renderToBuffer(element)
  } catch (err) {
    console.error('[quote-pdf] render error:', err)
    return NextResponse.json(
      { error: 'Failed to render quote PDF. See server logs.' },
      { status: 500 }
    )
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
    return NextResponse.json({ error: 'Failed to upload quote PDF.' }, { status: 500 })
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

  return NextResponse.json({
    ok: true,
    url: blob.url,
    key: blobKey,
    generatedAt: now.toISOString(),
  })
}

// Streams the Quote PDF bytes for an Order through this auth-gated
// route. Private Vercel Blob URLs aren't directly fetchable from the
// browser — we always proxy through server-side auth via @vercel/blob's
// `get()`. Mirrors the contract counter-PDF route.
//
// Modes:
//   default          → Content-Disposition: inline   (renders in browser tab)
//   ?download=1      → Content-Disposition: attachment (triggers file download)
//   ?meta=1          → JSON metadata only (no proxy), for status-style polls
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: {
      orderNumber: true,
      quotePdfKey: true,
      quotePdfUrl: true,
      quotePdfGeneratedAt: true,
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const wantMeta = req.nextUrl.searchParams.get('meta') === '1'
  if (wantMeta) {
    return NextResponse.json({
      url: order.quotePdfUrl,
      key: order.quotePdfKey,
      generatedAt: order.quotePdfGeneratedAt,
    })
  }

  if (!order.quotePdfKey) {
    return NextResponse.json({ error: 'No quote PDF for this order' }, { status: 404 })
  }

  const wantDownload = req.nextUrl.searchParams.get('download') === '1'
  const disposition = wantDownload
    ? `attachment; filename="Quote-${order.orderNumber}.pdf"`
    : `inline; filename="Quote-${order.orderNumber}.pdf"`

  try {
    const blob = await get(order.quotePdfKey, { access: 'private' })
    if (!blob || blob.statusCode !== 200 || !blob.stream) {
      return NextResponse.json({ error: 'File not available' }, { status: 502 })
    }
    const headers = new Headers()
    headers.set('Content-Type', blob.blob.contentType || 'application/pdf')
    headers.set('Content-Disposition', disposition)
    if (blob.blob.size != null) headers.set('Content-Length', String(blob.blob.size))
    headers.set('Cache-Control', 'private, no-store')
    return new NextResponse(blob.stream, { status: 200, headers })
  } catch (err) {
    console.error('[quote-pdf] proxy error:', err)
    return NextResponse.json({ error: 'Failed to fetch quote PDF' }, { status: 500 })
  }
}
