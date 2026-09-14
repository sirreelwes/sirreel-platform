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
  type PickListReceipt,
  type ReceiptAddedLine,
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
  opts: { lineIds?: string[]; receipt?: boolean } = {},
): Promise<RenderPickListFailure | { ok: true; result: RenderPickListResult }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      // Receipt mode reads the filed check-OUT sheet — see below. Loaded
      // unconditionally because it is one indexed row on a unique key,
      // and a second query would open a window where the sheet is filed
      // between the two reads.
      checkReports: {
        where: { edge: 'OUT' },
        select: {
          submittedAt: true,
          preppedBy: true,
          lines: {
            select: {
              orderLineItemId: true, description: true, expectedQty: true,
              actualQty: true, change: true, onSheet: true, note: true,
            },
          },
        },
      },
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

  // ── The driver's receipt (Oliver, 2026-09-13) ──────────────────────
  // "When they enter all of the picked quantities and make the out
  // contract, they don't have the ability to print the pick list with
  // the completed quantities to give to the driver. This is an
  // important feature, as it's the driver's receipt."
  //
  // It reads the FILED CHECK-OUT REPORT, not the order and not the pick
  // statuses, and the difference shows on every line that is not
  // ordinary:
  //   - the report holds expected AND actual, so a short line prints
  //     both numbers. The order line only kept the actual (a check-out
  //     rewrites it), so an order-derived receipt would claim six went
  //     out on a line where four did;
  //   - the report holds rows the warehouse WROTE IN, which are never
  //     order lines at all (the yard cannot see rates) and would
  //     otherwise be missing from the paper for gear that is on the
  //     truck;
  //   - a partial pull's off-sheet lines were not counted, so they are
  //     not on this load and must not print as though they were.
  const filedOut = order.checkReports[0] ?? null
  if (opts.receipt && !filedOut) {
    return {
      ok: false,
      error: 'No check-out report has been filed for this order yet — the receipt prints the counts on one.',
      status: 400,
    }
  }

  let receipt: PickListReceipt | null = null
  /** Order lines that exist only because the warehouse wrote them in —
   *  printed in their own block, so they are not part of the pull. */
  const addedLineIds = new Set<string>()
  /** What the sheet counted, keyed by order line. Null off receipt mode. */
  let counted: Map<string, { expectedQty: number; actualQty: number; note: string | null }> | null = null
  if (opts.receipt && filedOut) {
    counted = new Map()
    const addedLines: ReceiptAddedLine[] = []
    for (const l of filedOut.lines) {
      if (!l.onSheet) continue
      if (!l.orderLineItemId || l.change === 'ADDED') {
        addedLines.push({ description: l.description, quantity: l.actualQty, note: l.note })
        // Since 2026-09-14 a written-in row is ALSO an order line. It
        // still prints once, under "Added at the warehouse" — but the
        // line it became has to be taken out of the ordinary set, or the
        // sheet counts it as a line that was left off the pull and
        // stamps the whole receipt PARTIAL.
        if (l.orderLineItemId) addedLineIds.add(l.orderLineItemId)
        continue
      }
      counted.set(l.orderLineItemId, {
        expectedQty: l.expectedQty, actualQty: l.actualQty, note: l.note,
      })
    }
    receipt = { preppedBy: filedOut.preppedBy, countedAt: filedOut.submittedAt, addedLines }
  }

  // On a receipt the SHEET's scope wins over ?lines= — what the driver
  // is holding is what was counted, and a stale selection from whatever
  // screen printed it must not quietly drop a line off the record.
  const onSheet = counted
    ? pickable.filter((li) => counted!.has(li.id))
    : (selected.length > 0 ? selected : pickable)
  // Written-in lines are accounted for in their own block, so they are
  // neither on the pull nor missing from it.
  const omittedLineCount =
    pickable.filter((li) => !addedLineIds.has(li.id)).length - onSheet.length

  if (onSheet.length === 0) {
    return {
      ok: false,
      error: 'The filed check-out report did not count any pickable line on this order.',
      status: 400,
    }
  }

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
    // On the receipt the numbers come off the sheet: `ordered` is what
    // the order called for when it was counted and `out` is what was
    // put on the truck. Everywhere else they mean "what to pull" and
    // "how much of it is already pulled".
    const sheet = counted?.get(li.id) ?? null
    return {
      department: li.department as Department,
      code: li.inventoryItem?.code ?? null,
      description: li.description,
      // A receipt is a record, so it carries what the floor wrote next
      // to the line — but never the unchecked pull boxes, which ask a
      // question this document has already answered.
      notes: sheet ? (sheet.note ?? li.notes) : li.notes,
      type: li.type === 'EXPENDABLE' ? 'SALE' : 'RENT',
      ordered: sheet ? sheet.expectedQty : li.quantity,
      out: sheet ? sheet.actualQty : (isOut ? li.quantity : 0),
      picked: warehousePicked,
      includedAccessory: !!li.autoKitPieceId,
      unitChecks: receipt ? [] : printableChecks(li.inventoryItem?.unitChecks ?? []),
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
      receipt,
    }) as React.ReactElement<DocumentProps>
    const pdf = await renderToBuffer(element)
    return {
      ok: true,
      result: {
        pdf,
        stem: receipt
          ? `GearReceipt-${order.orderNumber}${omittedLineCount > 0 ? '-partial' : ''}`
          : omittedLineCount > 0
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
