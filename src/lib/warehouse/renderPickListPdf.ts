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
import { applyFiledSheet } from '@/lib/warehouse/driverCopy'

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
  opts: {
    lineIds?: string[]
    /**
     * The DRIVER'S COPY (Wes 2026-09-12): render the sheet from the FILED
     * check-out report — the Picked column carries the counts the
     * supervisor typed in, a swapped line reads as the swapped-in piece,
     * a row added at the dock is on it, and lines a partial pull left on
     * the shelf are off it. 404s when no OUT report is filed: there is
     * nothing to receipt yet. Pure derivation in driverCopy.ts.
     */
    filed?: 'OUT'
  } = {},
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
  const filedReport = opts.filed
    ? await prisma.orderCheckReport.findUnique({
        where: { orderId_edge: { orderId, edge: opts.filed } },
        select: {
          submittedAt: true,
          preppedBy: true,
          lines: { select: { orderLineItemId: true, actualQty: true, onSheet: true } },
        },
      })
    : null
  if (opts.filed && !filedReport) {
    return { ok: false, error: 'No check-out report is filed for this order yet', status: 404 }
  }

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
  // The driver's copy takes its line set and its counts from the filed
  // sheet instead: what a partial pull left on the shelf is off it.
  const filedSheet = filedReport ? applyFiledSheet(pickable, filedReport.lines) : null
  const onSheet = filedSheet
    ? filedSheet.onSheet.map((x) => x.line)
    : selected.length > 0 ? selected : pickable
  const pickedQtyById = new Map(filedSheet?.onSheet.map((x) => [x.line.id, x.pickedQty]) ?? [])
  const omittedLineCount = filedSheet ? filedSheet.omittedLineCount : pickable.length - onSheet.length

  // A check that is ALREADY its own line on this sheet must not also
  // print under the parent — the RW sheet the floor knows shows
  // "CP200 - Antenna  15" as a line, and a parent that then repeats
  // "Each unit: ( ) Antenna" is the same thing counted twice.
  const lineNames = new Set(
    onSheet.map((li) => li.description.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()),
  )
  const printableChecks = (checks: string[]): string[] =>
    checks.filter((c) => {
      const key = c.toLowerCase().trim()
      for (const name of lineNames) if (name.includes(key)) return false
      return true
    })

  const lines: PickListLine[] = onSheet.map((li) => {
    // "Out" = already pulled. Warehouse lines advance through the
    // digital picking floor; fleet lines flip in bulk when the fleet
    // lane is stamped ready. Pre-book lines (no lane yet) are all
    // remaining.
    const warehousePicked = li.pickStatus != null && li.pickStatus !== 'PENDING_PICK'
    const fleetOut = li.fulfillmentLane === 'FLEET' && order.fleetReadyAt != null
    const isOut = warehousePicked || fleetOut
    // On the driver's copy the filed count IS the out count: Remaining
    // reads ordered − picked, so a short line shows what did not go.
    const pickedQty = filedSheet ? (pickedQtyById.get(li.id) ?? null) : undefined
    return {
      department: li.department as Department,
      code: li.inventoryItem?.code ?? null,
      description: li.description,
      notes: li.notes,
      type: li.type === 'EXPENDABLE' ? 'SALE' : 'RENT',
      ordered: li.quantity,
      out: filedSheet ? (pickedQty ?? 0) : isOut ? li.quantity : 0,
      picked: warehousePicked,
      ...(filedSheet ? { pickedQty } : {}),
      includedAccessory: !!li.autoKitPieceId,
      unitChecks: printableChecks(li.inventoryItem?.unitChecks ?? []),
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
      ...(filedReport
        ? { filed: { at: filedReport.submittedAt, preppedBy: filedReport.preppedBy } }
        : {}),
    }) as React.ReactElement<DocumentProps>
    const pdf = await renderToBuffer(element)
    const base = filedReport ? `PickList-${order.orderNumber}-checked-out` : `PickList-${order.orderNumber}`
    return {
      ok: true,
      result: {
        pdf,
        stem: omittedLineCount > 0 ? `${base}-partial` : base,
        orderNumber: order.orderNumber,
        omittedLineCount,
      },
    }
  } catch (err) {
    console.error('[renderPickListPdf] render error:', err)
    return { ok: false, error: 'Failed to render pick list PDF. See server logs.', status: 500 }
  }
}
