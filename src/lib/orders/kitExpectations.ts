/**
 * Reading the catalog's kit promises for one order.
 *
 * The DB half of src/lib/orders/kitCompleteness.ts, kept apart so the
 * pure check can run in the supervisor's browser against numbers being
 * typed. This module answers "what does the catalog say should be on
 * this truck"; that one answers "and was it".
 *
 * Grouping matches `deriveKitPieceLines` exactly — piece + ratio, parents
 * summed before the ratio — because a completeness check that groups
 * differently from the reconciler would report a shortfall against lines
 * the reconciler itself created.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import type { KitExpectation } from '@/lib/orders/kitCompleteness'

type Db = Prisma.TransactionClient | typeof prisma

/** The shape this needs from an order line — nothing more. */
export interface ExpectationLine {
  id: string
  inventoryItemId: string | null
}

/** One live kit rule, flattened to what the expectation builder needs. */
export interface KitRule {
  parentItemId: string
  parentName: string
  pieceItemId: string
  pieceName: string
  qtyPer: number
  perUnits: number
  rounding: 'CEIL' | 'FLOOR'
  minQty: number
  sortOrder: number
}

/**
 * Every live kit rule, optionally narrowed to the parents in hand.
 *
 * Split out so a sweep over many orders asks once instead of once per
 * order — the table is small (a handful of rows) and the alternative was
 * a query per order in a provider that runs on every page load.
 */
export async function loadKitRules(
  db: Db = prisma,
  parentItemIds?: string[],
): Promise<KitRule[]> {
  if (parentItemIds && parentItemIds.length === 0) return []
  const kits = await db.inventoryKitPiece.findMany({
    where: {
      ...(parentItemIds ? { parentItemId: { in: parentItemIds } } : {}),
      isActive: true,
      piece: { isActive: true },
    },
    include: {
      parent: { select: { id: true, code: true, description: true } },
      piece: { select: { id: true, code: true, description: true } },
    },
    orderBy: [{ sortOrder: 'asc' }],
  })
  return kits.map((k) => ({
    parentItemId: k.parentItemId,
    parentName: k.parent.description || k.parent.code,
    pieceItemId: k.pieceItemId,
    pieceName: k.piece.description || k.piece.code,
    qtyPer: Number(k.qtyPer),
    perUnits: k.perUnits,
    rounding: k.rounding,
    minQty: k.minQty,
    sortOrder: k.sortOrder,
  }))
}

/**
 * What the catalog owes these lines, as expectations the pure check can
 * consume. Returns [] when nothing on the order has a kit — the common
 * case, and one indexed query.
 *
 * `lines` is passed in rather than read here so the caller (which has
 * already loaded the order) does not pay for a second read, and so a
 * draft that is being assembled can be checked before it is saved.
 */
export async function kitExpectationsFor(
  lines: ExpectationLine[],
  db: Db = prisma,
): Promise<KitExpectation[]> {
  const parentItemIds = Array.from(
    new Set(lines.map((l) => l.inventoryItemId).filter((id): id is string => !!id)),
  )
  if (parentItemIds.length === 0) return []
  return buildKitExpectations(lines, await loadKitRules(db, parentItemIds))
}

/**
 * The grouping itself — pure, so a sweep can reuse one rule read across
 * every order it looked at.
 */
export function buildKitExpectations(
  lines: ExpectationLine[],
  rules: KitRule[],
): KitExpectation[] {
  const kits = rules
  if (kits.length === 0) return []

  // Every line carrying a given item, so a piece ordered by the client
  // counts toward the promise just as much as one the reconciler added.
  const linesByItem = new Map<string, string[]>()
  for (const l of lines) {
    if (!l.inventoryItemId) continue
    const arr = linesByItem.get(l.inventoryItemId) ?? []
    arr.push(l.id)
    linesByItem.set(l.inventoryItemId, arr)
  }

  const groups = new Map<string, KitExpectation>()
  for (const kit of kits) {
    const key = [
      kit.pieceItemId,
      kit.qtyPer,
      kit.perUnits,
      kit.rounding,
      kit.minQty,
    ].join('|')
    const parentName = kit.parentName
    const parentLineIds = linesByItem.get(kit.parentItemId) ?? []
    if (parentLineIds.length === 0) continue

    const existing = groups.get(key)
    if (existing) {
      existing.parentNames.push(parentName)
      existing.parentLineIds.push(...parentLineIds)
      continue
    }
    groups.set(key, {
      key,
      pieceItemId: kit.pieceItemId,
      pieceDescription: kit.pieceName,
      ratio: {
        qtyPer: kit.qtyPer,
        perUnits: kit.perUnits,
        rounding: kit.rounding,
        minQty: kit.minQty,
      },
      parentNames: [parentName],
      parentLineIds: [...parentLineIds],
      // Empty here means the order has no line for the piece at all —
      // the check reports that differently, because adding the line is
      // the desk's job and loading the gear is the floor's.
      pieceLineIds: linesByItem.get(kit.pieceItemId) ?? [],
    })
  }

  return [...groups.values()]
}
