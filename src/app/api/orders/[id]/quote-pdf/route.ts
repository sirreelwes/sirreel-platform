import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { randomUUID } from 'crypto'
import { put, del } from '@vercel/blob'
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
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.lineItems.length === 0) {
    return NextResponse.json({ error: 'Order has no line items' }, { status: 400 })
  }

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
    lineTotal: Number(li.lineTotal),
    isDiscount: li.type === 'DISCOUNT',
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

// Returns the current Quote PDF URL (and metadata) for an Order — for
// link rendering on the Order detail page. Does not regenerate.
//
// When called with ?download=1, instead proxies the blob bytes back to
// the caller with Content-Disposition: attachment so the browser
// triggers a file download instead of rendering inline. The Vercel
// Blob URL itself always serves inline.
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

  const wantDownload = req.nextUrl.searchParams.get('download') === '1'
  if (wantDownload) {
    if (!order.quotePdfUrl) {
      return NextResponse.json({ error: 'No quote PDF for this order' }, { status: 404 })
    }
    let upstream: Response
    try {
      upstream = await fetch(order.quotePdfUrl)
    } catch (err) {
      console.error('[quote-pdf] fetch error:', err)
      return NextResponse.json({ error: 'Failed to fetch PDF blob' }, { status: 502 })
    }
    if (!upstream.ok) {
      return NextResponse.json({ error: `Blob fetch ${upstream.status}` }, { status: 502 })
    }
    const bytes = await upstream.arrayBuffer()
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Quote-${order.orderNumber}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }

  return NextResponse.json({
    url: order.quotePdfUrl,
    key: order.quotePdfKey,
    generatedAt: order.quotePdfGeneratedAt,
  })
}
