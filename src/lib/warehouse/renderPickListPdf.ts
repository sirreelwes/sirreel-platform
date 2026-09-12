/**
 * The pull sheet, as bytes — the ONE place the warehouse PDF is built.
 *
 * Extracted from GET /api/orders/[id]/pick-list-pdf on 2026-09-09, when
 * the send-to-warehouse email began ATTACHING the sheet rather than
 * linking it (Wes: "during the transition, pull list pdfs should be
 * sent to warehouse@sirreel.com for them to pull"). Two renderers would
 * have meant the sheet the floor prints and the sheet the floor is
 * emailed could drift — and the whole point is that they are the same
 * piece of paper.
 *
 * Still never stored in Blob: the document prints the LIVE pick state
 * (Out / Remaining move as the floor works), so a stored copy goes
 * stale the moment anyone picks an item. An emailed copy is a snapshot
 * by nature, which is exactly why the email also carries the link.
 */

import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { isPartnerLineIn, PARTNER_SUB_RENTAL_WHERE } from '@/lib/orders/partnerLines'
import React from 'react'
import { prisma } from '@/lib/prisma'
import {
  PickListDocument,
  type Department,
  type PickListLine,
} from '@/lib/warehouse/PickListDocument'

export interface RenderPickListResult {
  pdf: Buffer
  /** Filename stem, no extension — "PickList-S260909-004[-partial]". */
  stem: string
  orderNumber: string
  omittedLineCount: number
}

export type RenderPickListFailure =
  | { ok: false; error: string; status: 404 | 400 | 500 }

export async function renderPickListPdf(
  orderId: string,
  opts: { lineIds?: string[] } = {},
): Promise<RenderPickListFailure | { ok: true; result: RenderPickListResult }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      company: { select: { name: true } },
      agent: { select: { name: true } },
      job: { select: { jobCode: true, name: true } },
      pickList: { select: { assignedTo: { select: { name: true } } } },
      lineItems: {
        include: {
          inventoryItem: { select: { code: true, unitChecks: true } },
          subRentals: { where: PARTNER_SUB_RENTAL_WHERE, select: { id: true } },
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
  if (!order) return { ok: false, error: 'Order not found', status: 404 }

  // Physical goods only — fees, discounts, and labor have nothing to
  // pull off a shelf.
  // A partner's unit never passes through our warehouse (Wes 2026-09-11:
  // "keep partner lines off the pick list"; partnerLines.ts).
  const pickable = order.lineItems.filter(
    (li) => li.type !== 'FEE' && li.type !== 'DISCOUNT' && li.type !== 'LABOR' && !isPartnerLineIn(li, order.lineItems),
  )
  if (pickable.length === 0) {
    return { ok: false, error: 'Order has no pickable line items', status: 400 }
  }

  // A PARTIAL pull (Wes, 2026-09-04). Half an order going out today is
  // ordinary on a quote the client is still deciding on, and the floor
  // should carry a sheet for what is actually being pulled rather than a
  // full one with fourteen lines crossed out.
  //
  // Unknown ids are ignored rather than rejected: the selection comes off
  // a screen that may be a few seconds behind an edit, and a supervisor
  // standing at the printer needs paper, not a validation error. An empty
  // intersection falls back to the whole order for the same reason — a
  // blank sheet is worse than a complete one.
  const wanted = new Set((opts.lineIds ?? []).map((v) => v.trim()).filter(Boolean))
  const selected = wanted.size > 0 ? pickable.filter((li) => wanted.has(li.id)) : pickable
  const onSheet = selected.length > 0 ? selected : pickable
  const omittedLineCount = pickable.length - onSheet.length

  // Per-unit checks go through RAW. A check that is already its own line
  // on this sheet is suppressed by the document itself
  // (printableUnitChecks in PickListDocument), against the lines that
  // actually print — so a partial pull judges by what is on ITS sheet.
  const lines: PickListLine[] = onSheet.map((li) => {
    // "Out" = already pulled. Warehouse lines advance through the
    // digital picking floor; fleet lines flip in bulk when the fleet
    // lane is stamped ready. Pre-book lines (no lane yet) are all
    // remaining.
    const warehousePicked = li.pickStatus != null && li.pickStatus !== 'PENDING_PICK'
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
      unitChecks: li.inventoryItem?.unitChecks ?? [],
    }
  })

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
    const pdf = await renderToBuffer(element)
    return {
      ok: true,
      result: {
        pdf,
        stem:
          omittedLineCount > 0
            ? `PickList-${order.orderNumber}-partial`
            : `PickList-${order.orderNumber}`,
        orderNumber: order.orderNumber,
        omittedLineCount,
      },
    }
  } catch (err) {
    console.error('[renderPickListPdf] render error:', err)
    return { ok: false, error: 'Failed to render pick list PDF. See server logs.', status: 500 }
  }
}
