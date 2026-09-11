import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveScan, type ScanResolution } from '@/lib/warehouse/resolveScan'
import {
  clampMissing, decideIn, decideOut, isOpen, summarizeUnitScans,
  type LiveScan, type ScanEdge, type ScanLine, type UnitScanSummary,
} from '@/lib/warehouse/unitScanRules'

/**
 * Per-unit movement on an order — barcode phase 3, the write side.
 *
 * `recordUnitScan` is the one entry point for "someone scanned a label at
 * the check-out or check-in desk". It resolves the label through the
 * phase-2 resolver, loads what the rules need, lets unitScanRules decide,
 * and executes the decision in one transaction with an AuditLog row.
 *
 * Nothing here touches InventoryUnit or RentalWorks: the mirror stays
 * read-only, and HQ's own view of "where is SR004674" is derived from
 * the open OrderUnitScan row (see lookupUnit).
 *
 * The reads FAIL SOFT until `prisma db push` has created the table — the
 * check report screen must keep working on the day the code lands before
 * the schema does (same convention as the AHA grants). Writes do not:
 * a scan that cannot be recorded says so.
 */

export interface RecordScanArgs {
  orderId: string
  edge: ScanEdge
  raw: string
  userId: string
  /** Attach beyond the line's quantity, or unlisted. */
  allowOver?: boolean
  /** Close the unit's open row on another order as an implied return. */
  closeOpen?: boolean
}

export type RecordScanResult =
  | {
      ok: true
      outcome: 'attached' | 'closed' | 'attached-in' | 'duplicate'
      message: string
      scanId: string
      orderLineItemId: string | null
      unit: { barcode: string; description: string | null }
      /** The parent item's per-unit checks, so the desk can mark one missing. */
      checks: string[]
      summary: UnitScanSummary
    }
  | {
      ok: false
      status: 404 | 409 | 422
      code: string
      reason: string
      override: 'allowOver' | 'closeOpen' | null
      openOn?: { orderId: string; orderNumber: string }
    }

function isMissingTable(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === 'P2021' || err.code === 'P2022')
  )
}

const summaryRowSelect = {
  id: true,
  orderLineItemId: true,
  barcode: true,
  outScannedAt: true,
  inScannedAt: true,
  inImplied: true,
  missingOut: true,
  missingIn: true,
  inventoryUnit: { select: { description: true, inventoryItem: { select: { unitChecks: true } } } },
} satisfies Prisma.OrderUnitScanSelect

async function loadSummary(orderId: string, lineIds: string[]): Promise<UnitScanSummary> {
  const rows = await prisma.orderUnitScan.findMany({
    where: { orderId, voidedAt: null },
    select: summaryRowSelect,
    orderBy: { createdAt: 'asc' },
  })
  return summarizeUnitScans(
    lineIds,
    rows.map((r) => ({
      id: r.id,
      orderLineItemId: r.orderLineItemId,
      barcode: r.barcode,
      description: r.inventoryUnit.description,
      outScannedAt: r.outScannedAt,
      inScannedAt: r.inScannedAt,
      inImplied: r.inImplied,
      checks: r.inventoryUnit.inventoryItem?.unitChecks ?? [],
      missingOut: r.missingOut,
      missingIn: r.missingIn,
    })),
  )
}

/**
 * The order's scans, grouped by line. Null when the table does not exist
 * yet (schema not pushed) so the caller can hide the panel rather than
 * crash the report.
 */
export async function unitScanSummary(orderId: string): Promise<UnitScanSummary | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { lineItems: { select: { id: true }, orderBy: { sortOrder: 'asc' } } },
  })
  if (!order) return null
  try {
    return await loadSummary(orderId, order.lineItems.map((l) => l.id))
  } catch (err) {
    if (isMissingTable(err)) {
      console.warn('[unit-scans] sr_order_unit_scans is missing — run prisma db push')
      return null
    }
    throw err
  }
}

/**
 * Catalog rows that have at least one barcoded unit in the register —
 * the lines a scanner can count. Everything else is quantity-only and
 * is typed in as before.
 */
export async function unitTrackedItemIds(inventoryItemIds: string[]): Promise<Set<string>> {
  const ids = inventoryItemIds.filter(Boolean)
  if (!ids.length) return new Set()
  const rows = await prisma.inventoryUnit.groupBy({
    by: ['inventoryItemId'],
    where: { inventoryItemId: { in: ids }, inactive: false },
  })
  return new Set(rows.map((r) => r.inventoryItemId).filter((x): x is string => !!x))
}

function toLive(
  s: {
    id: string; orderId: string; orderLineItemId: string | null; inventoryUnitId: string;
    barcode: string; outScannedAt: Date | null; inScannedAt: Date | null;
    order: { orderNumber: string }
  },
): LiveScan {
  return {
    id: s.id,
    orderId: s.orderId,
    orderNumber: s.order.orderNumber,
    orderLineItemId: s.orderLineItemId,
    inventoryUnitId: s.inventoryUnitId,
    barcode: s.barcode,
    outScannedAt: s.outScannedAt,
    inScannedAt: s.inScannedAt,
  }
}

export async function recordUnitScan(args: RecordScanArgs): Promise<RecordScanResult> {
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      orderNumber: true,
      lineItems: {
        select: { id: true, inventoryItemId: true, description: true, quantity: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })
  if (!order) {
    return { ok: false, status: 404, code: 'order', reason: 'order not found', override: null }
  }
  const lines: ScanLine[] = order.lineItems.map((l) => ({
    orderLineItemId: l.id,
    inventoryItemId: l.inventoryItemId,
    description: l.description,
    quantity: l.quantity,
    sortOrder: l.sortOrder,
  }))
  const lineIds = lines.map((l) => l.orderLineItemId)

  const res: ScanResolution = await resolveScan(args.raw)

  const liveSelect = {
    id: true, orderId: true, orderLineItemId: true, inventoryUnitId: true, barcode: true,
    outScannedAt: true, inScannedAt: true, order: { select: { orderNumber: true } },
  } satisfies Prisma.OrderUnitScanSelect

  const thisOrderRows = await prisma.orderUnitScan.findMany({
    where: { orderId: order.id, voidedAt: null },
    select: liveSelect,
    orderBy: { createdAt: 'asc' },
  })
  const thisOrder = thisOrderRows.map(toLive)

  let openElsewhere: LiveScan | null = null
  if (res.kind === 'unit') {
    const rows = await prisma.orderUnitScan.findMany({
      where: {
        inventoryUnitId: res.unit.id,
        orderId: { not: order.id },
        voidedAt: null,
        outScannedAt: { not: null },
        inScannedAt: null,
      },
      select: liveSelect,
      orderBy: { outScannedAt: 'desc' },
      take: 1,
    })
    openElsewhere = rows[0] ? toLive(rows[0]) : null
  }

  // What every copy of this item must carry ("Antenna", "Battery") —
  // returned with the scan so the desk can mark one missing.
  const checks =
    res.kind === 'unit'
      ? (await prisma.inventoryItem.findUnique({
          where: { id: res.inventoryItemId },
          select: { unitChecks: true },
        }))?.unitChecks ?? []
      : []

  const ctx = { lines, thisOrder, openElsewhere, allowOver: args.allowOver, closeOpen: args.closeOpen }
  const now = new Date()

  if (args.edge === 'OUT') {
    const d = decideOut(res, ctx)
    if (d.kind === 'refuse') {
      return {
        ok: false, status: 409, code: d.code, reason: d.reason, override: d.override,
        openOn: d.openOn ? { orderId: d.openOn.orderId, orderNumber: d.openOn.orderNumber } : undefined,
      }
    }
    if (res.kind !== 'unit') throw new Error('unreachable')
    const unit = { barcode: res.unit.barcode, description: res.unit.description }

    if (d.kind === 'duplicate') {
      return {
        ok: true, outcome: 'duplicate', scanId: d.scanId, orderLineItemId: null, unit, checks,
        message: d.position
          ? `${res.scanned} is already counted on this order (${d.position.n} of ${d.position.of}).`
          : `${res.scanned} is already counted on this order.`,
        summary: await loadSummary(order.id, lineIds),
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      if (d.closeScanId) {
        await tx.orderUnitScan.update({
          where: { id: d.closeScanId },
          data: { inScannedAt: now, inScannedById: args.userId, inImplied: true },
        })
        await tx.auditLog.create({
          data: {
            userId: args.userId,
            action: 'order.unit_scanned_in',
            entityType: 'OrderUnitScan',
            entityId: d.closeScanId,
            oldValues: { inScannedAt: null },
            newValues: {
              inScannedAt: now.toISOString(), implied: true, barcode: res.scanned,
              closedBy: { orderId: order.id, orderNumber: order.orderNumber },
            },
          },
        })
      }
      const row = await tx.orderUnitScan.create({
        data: {
          orderId: order.id,
          orderLineItemId: d.orderLineItemId,
          inventoryUnitId: res.unit.id,
          inventoryItemId: res.inventoryItemId,
          barcode: res.scanned,
          outScannedAt: now,
          outScannedById: args.userId,
        },
        select: { id: true },
      })
      await tx.auditLog.create({
        data: {
          userId: args.userId,
          action: 'order.unit_scanned_out',
          entityType: 'OrderUnitScan',
          entityId: row.id,
          newValues: {
            orderId: order.id, orderNumber: order.orderNumber, orderLineItemId: d.orderLineItemId,
            inventoryUnitId: res.unit.id, barcode: res.scanned, over: d.over,
            closedOpenScanId: d.closeScanId,
          },
        },
      })
      return row
    })

    const line = d.orderLineItemId ? lines.find((l) => l.orderLineItemId === d.orderLineItemId) : null
    const where = line
      ? `${line.description}${d.position ? ` · ${d.position.n} of ${d.position.of}` : ''}${d.over ? ' · over the order' : ''}`
      : 'not on the order — recorded as an addition'
    const closed = d.closeOnOrderNumber ? ` Marked back from ${d.closeOnOrderNumber}.` : ''
    return {
      ok: true, outcome: 'attached', scanId: created.id, orderLineItemId: d.orderLineItemId, unit, checks,
      message: `${res.scanned}${unit.description ? ` ${unit.description}` : ''} → ${where}.${closed}`,
      summary: await loadSummary(order.id, lineIds),
    }
  }

  // IN
  const d = decideIn(res, ctx)
  if (d.kind === 'refuse') {
    return {
      ok: false, status: 409, code: d.code, reason: d.reason, override: d.override,
      openOn: d.openOn ? { orderId: d.openOn.orderId, orderNumber: d.openOn.orderNumber } : undefined,
    }
  }
  if (res.kind !== 'unit') throw new Error('unreachable')
  const unit = { barcode: res.unit.barcode, description: res.unit.description }

  if (d.kind === 'duplicate') {
    return {
      ok: true, outcome: 'duplicate', scanId: d.scanId, orderLineItemId: null, unit, checks,
      message: `${res.scanned} is already marked back.`,
      summary: await loadSummary(order.id, lineIds),
    }
  }

  if (d.kind === 'close') {
    await prisma.$transaction(async (tx) => {
      await tx.orderUnitScan.update({
        where: { id: d.scanId },
        data: { inScannedAt: now, inScannedById: args.userId, inImplied: false },
      })
      await tx.auditLog.create({
        data: {
          userId: args.userId,
          action: 'order.unit_scanned_in',
          entityType: 'OrderUnitScan',
          entityId: d.scanId,
          oldValues: { inScannedAt: null },
          newValues: {
            inScannedAt: now.toISOString(), implied: false, barcode: res.scanned,
            scannedAt: { orderId: order.id, orderNumber: order.orderNumber },
          },
        },
      })
    })
    const line = thisOrder.find((s) => s.id === d.scanId)?.orderLineItemId
    const desc = line ? lines.find((l) => l.orderLineItemId === line)?.description : null
    return {
      ok: true, outcome: 'closed', scanId: d.scanId, orderLineItemId: line ?? null, unit, checks,
      message: d.onThisOrder
        ? `${res.scanned}${unit.description ? ` ${unit.description}` : ''} is back${desc ? ` · ${desc}` : ''}.`
        : `${res.scanned} marked back from ${d.onOrderNumber}.`,
      summary: await loadSummary(order.id, lineIds),
    }
  }

  // attach-in
  const row = await prisma.$transaction(async (tx) => {
    const r = await tx.orderUnitScan.create({
      data: {
        orderId: order.id,
        orderLineItemId: d.orderLineItemId,
        inventoryUnitId: res.unit.id,
        inventoryItemId: res.inventoryItemId,
        barcode: res.scanned,
        inScannedAt: now,
        inScannedById: args.userId,
      },
      select: { id: true },
    })
    await tx.auditLog.create({
      data: {
        userId: args.userId,
        action: 'order.unit_scanned_in',
        entityType: 'OrderUnitScan',
        entityId: r.id,
        newValues: {
          orderId: order.id, orderNumber: order.orderNumber, orderLineItemId: d.orderLineItemId,
          inventoryUnitId: res.unit.id, barcode: res.scanned, neverScannedOut: true,
        },
      },
    })
    return r
  })
  return {
    ok: true, outcome: 'attached-in', scanId: row.id, orderLineItemId: d.orderLineItemId, unit, checks,
    message: `${res.scanned}${unit.description ? ` ${unit.description}` : ''} is back — it was never scanned out, so it's recorded now.`,
    summary: await loadSummary(order.id, lineIds),
  }
}

/**
 * The desk marking a per-unit check missing (or present again) on one
 * scan — "SR004674 went out without its antenna". Names are clamped to
 * the parent item's list; the whole list is replaced, so the chips are
 * the state.
 */
export async function setUnitScanMissing(args: {
  orderId: string
  scanId: string
  edge: ScanEdge
  missing: unknown
  userId: string
}): Promise<
  | { ok: true; missing: string[]; checks: string[]; summary: UnitScanSummary }
  | { ok: false; status: 404 | 409; reason: string }
> {
  const row = await prisma.orderUnitScan.findUnique({
    where: { id: args.scanId },
    select: {
      id: true, orderId: true, voidedAt: true, barcode: true, missingOut: true, missingIn: true,
      inventoryUnit: { select: { inventoryItem: { select: { unitChecks: true } } } },
    },
  })
  if (!row || row.orderId !== args.orderId) return { ok: false, status: 404, reason: 'scan not found on this order' }
  if (row.voidedAt) return { ok: false, status: 409, reason: 'that scan was withdrawn' }
  const checks = row.inventoryUnit.inventoryItem?.unitChecks ?? []
  const missing = clampMissing(checks, args.missing)
  const before = args.edge === 'OUT' ? row.missingOut : row.missingIn
  await prisma.$transaction(async (tx) => {
    await tx.orderUnitScan.update({
      where: { id: row.id },
      data: args.edge === 'OUT' ? { missingOut: missing } : { missingIn: missing },
    })
    await tx.auditLog.create({
      data: {
        userId: args.userId,
        action: 'order.unit_scan_checks',
        entityType: 'OrderUnitScan',
        entityId: row.id,
        oldValues: { edge: args.edge, missing: before },
        newValues: { edge: args.edge, missing, barcode: row.barcode, checks },
      },
    })
  })
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: { lineItems: { select: { id: true }, orderBy: { sortOrder: 'asc' } } },
  })
  return {
    ok: true, missing, checks,
    summary: await loadSummary(args.orderId, (order?.lineItems ?? []).map((l) => l.id)),
  }
}

/** Undo a wrong scan. The row stays, voided, so the mistake is on record. */
export async function voidUnitScan(args: {
  orderId: string
  scanId: string
  userId: string
  reason: string | null
}): Promise<{ ok: true; summary: UnitScanSummary } | { ok: false; status: 404 | 409; reason: string }> {
  const row = await prisma.orderUnitScan.findUnique({
    where: { id: args.scanId },
    select: { id: true, orderId: true, voidedAt: true, barcode: true, outScannedAt: true, inScannedAt: true },
  })
  if (!row || row.orderId !== args.orderId) return { ok: false, status: 404, reason: 'scan not found on this order' }
  if (row.voidedAt) return { ok: false, status: 409, reason: 'already voided' }
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.orderUnitScan.update({
      where: { id: row.id },
      data: { voidedAt: now, voidedById: args.userId, voidReason: args.reason },
    })
    await tx.auditLog.create({
      data: {
        userId: args.userId,
        action: 'order.unit_scan_voided',
        entityType: 'OrderUnitScan',
        entityId: row.id,
        oldValues: { outScannedAt: row.outScannedAt, inScannedAt: row.inScannedAt, barcode: row.barcode },
        newValues: { voidedAt: now.toISOString(), reason: args.reason },
      },
    })
  })
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: { lineItems: { select: { id: true }, orderBy: { sortOrder: 'asc' } } },
  })
  return { ok: true, summary: await loadSummary(args.orderId, (order?.lineItems ?? []).map((l) => l.id)) }
}

// ── "Where is this unit?" ────────────────────────────────────────────

export interface UnitLookup {
  scanned: string
  resolution: ScanResolution['kind']
  unit: {
    id: string
    barcode: string
    serialNumber: string | null
    description: string | null
    catalogName: string | null
    rwStatus: string | null
    warehouse: string | null
    shelf: string | null
    replacementCost: string | null
    lastSeenAt: string
  } | null
  /** HQ's view: the open scan, if any. */
  out: {
    scanId: string
    orderId: string
    orderNumber: string
    jobName: string | null
    company: string | null
    since: string
    lineDescription: string | null
  } | null
  history: Array<{
    scanId: string
    orderId: string
    orderNumber: string
    jobName: string | null
    outAt: string | null
    inAt: string | null
    inImplied: boolean
    voided: boolean
    missingOut: string[]
    missingIn: string[]
  }>
  /** Null when the scan table is not there yet. */
  tracked: boolean
}

export async function lookupUnit(raw: string): Promise<UnitLookup> {
  const res = await resolveScan(raw)
  const base: UnitLookup = { scanned: res.scanned, resolution: res.kind, unit: null, out: null, history: [], tracked: true }
  if (res.kind !== 'unit' && res.kind !== 'unlinked-unit') return base

  const unit = await prisma.inventoryUnit.findUnique({
    where: { id: res.unit.id },
    select: {
      id: true, barcode: true, serialNumber: true, description: true, status: true, warehouse: true,
      aisleLocation: true, shelfLocation: true, replacementCost: true, lastSeenAt: true,
      inventoryItem: { select: { description: true } },
    },
  })
  if (!unit) return base
  base.unit = {
    id: unit.id,
    barcode: unit.barcode,
    serialNumber: unit.serialNumber,
    description: unit.description,
    catalogName: unit.inventoryItem?.description ?? null,
    rwStatus: unit.status,
    warehouse: unit.warehouse,
    shelf: [unit.aisleLocation, unit.shelfLocation].filter(Boolean).join(' / ') || null,
    replacementCost: unit.replacementCost ? unit.replacementCost.toString() : null,
    lastSeenAt: unit.lastSeenAt.toISOString(),
  }

  try {
    const rows = await prisma.orderUnitScan.findMany({
      where: { inventoryUnitId: unit.id },
      select: {
        id: true, orderId: true, outScannedAt: true, inScannedAt: true, inImplied: true, voidedAt: true,
        missingOut: true, missingIn: true,
        orderLineItem: { select: { description: true } },
        order: { select: { orderNumber: true, job: { select: { name: true } }, company: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
    })
    const open = rows.find((r) => !r.voidedAt && isOpen(r))
    base.out = open
      ? {
          scanId: open.id,
          orderId: open.orderId,
          orderNumber: open.order.orderNumber,
          jobName: open.order.job?.name ?? null,
          company: open.order.company?.name ?? null,
          since: open.outScannedAt!.toISOString(),
          lineDescription: open.orderLineItem?.description ?? null,
        }
      : null
    base.history = rows.map((r) => ({
      scanId: r.id,
      orderId: r.orderId,
      orderNumber: r.order.orderNumber,
      jobName: r.order.job?.name ?? null,
      outAt: r.outScannedAt ? r.outScannedAt.toISOString() : null,
      inAt: r.inScannedAt ? r.inScannedAt.toISOString() : null,
      inImplied: r.inImplied,
      voided: !!r.voidedAt,
      missingOut: r.missingOut,
      missingIn: r.missingIn,
    }))
  } catch (err) {
    if (!isMissingTable(err)) throw err
    base.tracked = false
  }
  return base
}
