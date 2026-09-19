/**
 * Line types put back in step with the catalog — the WORK, two entry points.
 *
 *   phone   /admin/maintenance → "Re-type order lines from the catalog"
 *   laptop  npx tsx scripts/retype-catalog-lines.ts [--write]
 *
 * Wes 2026-09-19, off a live order carrying two identical cargo-van lines —
 * one typed VEHICLE, its twin typed EQUIPMENT: "How did this end up as an
 * equipment line? Obviously it should always be a vehicle line."
 *
 * TWO DOORS WROTE IT WRONG, both now closed in code:
 *
 *   · The order page's "+ Add Item" form opens on EQUIPMENT and the catalog
 *     combobox only ever flipped that for an ASSET_CATEGORY or a partner
 *     hit. Vehicles have been InventoryItem rows since the department
 *     flattening, so picking "Cargo Van w/ Liftgate" out of the Search
 *     Inventory box left the form's default standing.
 *   · The inline row editor re-derived the type on EVERY save without the
 *     catalog row's own type to read, and `resolveLineType` falls through to
 *     EQUIPMENT for an INVENTORY row outside STAGES / EXPENDABLES. So a
 *     correctly-typed vehicle flipped the first time anyone touched its
 *     rate, quantity, dates or note.
 *
 * This fixes the rows already written. It is a RE-DERIVATION, not a guess:
 * every line is re-typed to exactly what `resolveLineType` answers from the
 * catalog row it is BOUND to — the same rule both routes now apply on write
 * — so running it after the deploy converges and running it twice changes
 * nothing.
 *
 * WHAT IT WILL NOT TOUCH, and why each one:
 *   · an UNBOUND line — free-typed, or a partner's unit, which carries no
 *     catalog FK. There is no row to read, and a department is not evidence
 *     (a per-vehicle FEE sits in VEHICLES too).
 *   · a FEE line, a package HEADER and every package MEMBER. Their type is
 *     set by the expansion that made them, not by the catalog row.
 *   · a line whose stored type already agrees. Reported as in step.
 *
 * Money is untouched either way: `computeLineTotal` prices on department,
 * rate type, quantity and days, and reads `type` nowhere. What the type
 * does decide is which controls a row offers, whether a truck shows up in
 * the COI's vehicle scope and in the replacement-value total, and whether
 * the which-unit picker appears at all — which is why a real van filed as
 * gear is worth correcting on orders that have already shipped.
 */

import { prisma } from '@/lib/prisma'
import { resolveLineType } from '@/lib/orders/lineType'
import type { LineItemType } from '@prisma/client'

export interface RetypeCatalogLinesOptions {
  dryRun: boolean
  actorUserId?: string | null
}

export interface RetypeChange {
  lineId: string
  orderNumber: string
  description: string
  from: LineItemType
  to: LineItemType
}

export interface RetypeCatalogLinesResult {
  dryRun: boolean
  log: string[]
  createdIds: string[]
  /** The line ids re-typed — what an undo is allowed to work from. */
  touchedIds: string[]
  warnings: string[]
  changes: RetypeChange[]
  /** Bound lines whose stored type already matched. */
  inStep: number
}

export async function retypeCatalogLines(
  opts: RetypeCatalogLinesOptions,
): Promise<RetypeCatalogLinesResult> {
  const { dryRun, actorUserId = null } = opts
  const log: string[] = []
  const result: RetypeCatalogLinesResult = {
    dryRun, log, createdIds: [], touchedIds: [], warnings: [], changes: [], inStep: 0,
  }
  const tag = dryRun ? '[dry run] ' : ''
  log.push(`${tag}Re-typing catalog-bound order lines from the catalog row…`)

  const lines = await prisma.orderLineItem.findMany({
    where: {
      // Bound to a catalog row — the only lines that HAVE an answer.
      OR: [{ inventoryItemId: { not: null } }, { assetCategoryId: { not: null } }],
      // A fee and a package are typed by what made them.
      feeItemId: null,
      isPackageHeader: false,
      packageInstanceId: null,
    },
    select: {
      id: true,
      type: true,
      department: true,
      description: true,
      inventoryItemId: true,
      assetCategoryId: true,
      inventoryItem: { select: { type: true } },
      order: { select: { orderNumber: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  log.push(`${lines.length} catalog-bound line(s) to check.`)

  for (const li of lines) {
    // An INVENTORY binding is answered by that row's own type; a legacy
    // ASSET_CATEGORY binding is answered by the kind alone (the rule reads
    // VEHICLE off it, and a stage still comes back EQUIPMENT).
    let want: LineItemType
    if (li.inventoryItemId) {
      const catalogType = li.inventoryItem?.type ?? null
      if (!catalogType) {
        // The row is gone or carries no type. Nothing to re-derive FROM, and
        // a department-shaped guess is what put us here.
        result.warnings.push(
          `${li.order?.orderNumber ?? '(no order)'} · "${li.description}" — bound to a catalog row with no readable type; left as ${li.type}.`,
        )
        continue
      }
      want = resolveLineType('INVENTORY', li.department, catalogType)
    } else {
      want = resolveLineType('ASSET_CATEGORY', li.department)
    }

    if (want === li.type) {
      result.inStep += 1
      continue
    }

    const change: RetypeChange = {
      lineId: li.id,
      orderNumber: li.order?.orderNumber ?? '(no order)',
      description: li.description,
      from: li.type,
      to: want,
    }
    result.changes.push(change)
    log.push(`  ${tag}${change.orderNumber} · "${change.description}" — ${change.from} → ${change.to}`)

    if (dryRun) continue

    await prisma.orderLineItem.update({ where: { id: li.id }, data: { type: want } })
    result.touchedIds.push(li.id)
    // Per-row, with the old value, so a wrong call here is reversible by id
    // without a journal file — which is the whole point when the run
    // happened on a phone.
    try {
      await prisma.auditLog.create({
        data: {
          action: 'order_line_item.retyped_from_catalog',
          entityType: 'OrderLineItem',
          entityId: li.id,
          userId: actorUserId,
          oldValues: { type: change.from },
          newValues: { type: change.to },
        },
      })
    } catch (err) {
      result.warnings.push(
        `${change.orderNumber} · "${change.description}" — re-typed, but the audit row failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  log.push('')
  log.push(`${result.inStep} line(s) already in step with the catalog.`)
  log.push(
    dryRun
      ? `${result.changes.length} line(s) would be re-typed.`
      : `${result.touchedIds.length} line(s) re-typed.`,
  )
  return result
}
