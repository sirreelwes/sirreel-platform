import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import React from 'react'
import { prisma } from '@/lib/prisma'
import {
  PickListDocument,
  type Department,
  type PickListLine,
} from '@/lib/warehouse/PickListDocument'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

// Warehouse Pick List PDF — rendered on demand and streamed inline,
// NEVER stored in Blob. The document prints the live pick state
// (Out / Remaining move as the picking floor scans items), so a stored
// copy would go stale the moment anyone picked an item. Layout is
// modeled on the RentalWorks pick list sample (see PickListDocument).
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
    include: {
      company: { select: { name: true } },
      agent: { select: { name: true } },
      job: { select: { jobCode: true, name: true } },
      pickList: {
        select: { assignedTo: { select: { name: true } } },
      },
      lineItems: {
        include: {
          inventoryItem: { select: { code: true } },
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  // Physical goods only — fees, discounts, and labor have nothing to
  // pull off a shelf.
  const pickable = order.lineItems.filter(
    (li) => li.type !== 'FEE' && li.type !== 'DISCOUNT' && li.type !== 'LABOR'
  )
  if (pickable.length === 0) {
    return NextResponse.json({ error: 'Order has no pickable line items' }, { status: 400 })
  }

  // ?lines=<id,id,…> — a PARTIAL pull (Wes, 2026-09-04). Half an order
  // going out today is ordinary on a quote the client is still deciding
  // on, and the floor should carry a sheet for what is actually being
  // pulled rather than a full one with fourteen lines crossed out.
  //
  // Unknown ids are ignored rather than 400ing: the selection comes off
  // a screen that may be a few seconds behind an edit, and a supervisor
  // standing at the printer needs paper, not a validation error. An
  // empty intersection falls back to the whole order for the same
  // reason — a blank sheet is worse than a complete one.
  const wanted = new Set(
    (req.nextUrl.searchParams.get('lines') ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  )
  const selected = wanted.size > 0 ? pickable.filter((li) => wanted.has(li.id)) : pickable
  const onSheet = selected.length > 0 ? selected : pickable
  const omittedLineCount = pickable.length - onSheet.length

  const lines: PickListLine[] = onSheet.map((li) => {
    // "Out" = already pulled. Warehouse lines advance through the
    // digital picking floor; fleet lines flip in bulk when the fleet
    // lane is stamped ready. Pre-book lines (no lane yet) are all
    // remaining.
    const warehousePicked =
      li.pickStatus != null && li.pickStatus !== 'PENDING_PICK'
    const fleetOut = li.fulfillmentLane === 'FLEET' && order.fleetReadyAt != null
    const isOut = warehousePicked || fleetOut
    return {
      department: li.department as Department,
      code: li.inventoryItem?.code ?? null,
      description: li.description,
      notes: li.notes,
      type: li.type === 'EXPENDABLE' ? 'SALE' : 'RENT',
      ordered: li.quantity,
      out: isOut ? li.quantity : 0,
      picked: warehousePicked,
      includedAccessory: !!li.autoKitPieceId,
    }
  })

  let pdfBytes: Buffer
  try {
    const element = React.createElement(PickListDocument, {
      orderNumber: order.orderNumber,
      description: order.description,
      companyName: order.company.name,
      jobCode: order.job?.jobCode ?? null,
      jobName: order.job?.name ?? null,
      deliveryType: order.deliveryRequested ? 'DELIVER' : 'WILL CALL',
      assignedToName: order.pickList?.assignedTo?.name ?? null,
      agentName: order.agent.name,
      startDate: order.startDate,
      endDate: order.endDate,
      pickDate: order.startDate,
      lines,
      generatedAt: new Date(),
      omittedLineCount,
    }) as React.ReactElement<DocumentProps>
    pdfBytes = await renderToBuffer(element)
  } catch (err) {
    console.error('[pick-list-pdf] render error:', err)
    return NextResponse.json(
      { error: 'Failed to render pick list PDF. See server logs.' },
      { status: 500 }
    )
  }

  const wantDownload = req.nextUrl.searchParams.get('download') === '1'
  const stem = omittedLineCount > 0
    ? `PickList-${order.orderNumber}-partial`
    : `PickList-${order.orderNumber}`
  const disposition = wantDownload
    ? `attachment; filename="${stem}.pdf"`
    : `inline; filename="${stem}.pdf"`

  return new NextResponse(new Uint8Array(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': disposition,
      'Content-Length': String(pdfBytes.length),
      'Cache-Control': 'private, no-store',
    },
  })
}
