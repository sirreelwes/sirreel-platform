/**
 * Included accessories — expanding InventoryKitPiece rows into order lines.
 *
 * The pieces that leave the building with a rented item whether or not
 * the client asked for them: charging banks and spare batteries with
 * walkies. This module is the ONLY place the ratio arithmetic lives.
 *
 * Replaces the hardcoded src/lib/sales/walkieKit.ts, which knew about
 * exactly one item and emitted text-only lines — nothing to scan on the
 * pick list, nothing to decrement, nothing to check back in against. A
 * kit piece here resolves to a REAL catalog row, so an auto-added line
 * is indistinguishable downstream from one the client ordered.
 */

import { prisma } from '@/lib/prisma'
import type {
  KitPieceBilling,
  LineItemDepartment,
  LineItemType,
  Prisma,
} from '@prisma/client'
import { resolveKitQuantity } from './kitMath'

export { resolveKitQuantity, describeKitRatio } from './kitMath'
export type { KitRatio } from './kitMath'

type Db = Prisma.TransactionClient | typeof prisma

/** A line the caller already has — the thing kits are sized against. */
export interface KitInputLine {
  inventoryItemId: string | null | undefined
  quantity: number
}

/** One accessory to add, resolved against the live catalog. */
export interface KitPieceLine {
  /** The InventoryKitPiece row this came from. Stamped onto the created
   *  OrderLineItem as `autoKitPieceId` — the provenance the reconciler
   *  in src/lib/orders/kitSync.ts matches on, so it only ever resizes
   *  and removes lines it created. Where parents were grouped by an
   *  identical ratio, this is the representative row for the group. */
  kitPieceId: string
  pieceItemId: string
  /** Item's display name — what the rep and the picker read. */
  description: string
  code: string
  quantity: number
  /** 0 for FREE pieces; the piece's own catalog rate when CHARGED. */
  rate: number
  billing: KitPieceBilling
  /** The PIECE's own department and line type — a battery bills and
   *  routes as a battery, not as whatever pulled it in. */
  department: LineItemDepartment
  lineType: LineItemType
  clientVisible: boolean
  /** Rep-facing reason the line appeared, so it never reads as a parse error. */
  note: string
  /** The parent item(s) that pulled this piece in — for the note and for grouping. */
  parentItemIds: string[]
}

/**
 * What's missing from these lines' kits.
 *
 * Parents sharing an identical ratio for the same piece are summed
 * BEFORE the ratio is applied — 6 analog + 6 digital radios need one
 * charging bank between them, not one each, which is what per-parent
 * rounding would have produced.
 *
 * Returns [] when nothing has a kit, or when the client already listed
 * the accessory themselves (suppressIfOrdered) — their line stands.
 */
export async function deriveKitPieceLines(
  lines: KitInputLine[],
  db: Db = prisma,
): Promise<KitPieceLine[]> {
  // Parent quantities, summed across lines — two radio lines are one
  // radio count as far as the charging bank is concerned.
  const parentQty = new Map<string, number>()
  for (const l of lines) {
    if (!l.inventoryItemId) continue
    const q = Math.floor(Number(l.quantity) || 0)
    if (q <= 0) continue
    parentQty.set(l.inventoryItemId, (parentQty.get(l.inventoryItemId) ?? 0) + q)
  }
  if (parentQty.size === 0) return []

  const kits = await db.inventoryKitPiece.findMany({
    where: {
      parentItemId: { in: [...parentQty.keys()] },
      isActive: true,
      piece: { isActive: true },
    },
    include: {
      // The parent's name so the auto-added line can say what pulled it
      // in — "Included with 12 × Motorola CP200 UHF Radio" reads as a
      // decision; "Included with 12" reads as a bug.
      parent: { select: { id: true, code: true, description: true } },
      piece: {
        select: {
          id: true,
          code: true,
          description: true,
          dailyRate: true,
          department: true,
          type: true,
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }],
  })
  if (kits.length === 0) return []

  // Already on the order — the client asked for it, so leave their line
  // alone rather than shipping and quoting it twice.
  const orderedIds = new Set(
    lines.map((l) => l.inventoryItemId).filter((id): id is string => !!id),
  )

  // Group by piece + identical ratio so shared parents combine before
  // rounding. Different ratios for the same piece stay separate rows —
  // they're different promises and summing them would be a guess.
  const groups = new Map<
    string,
    { kit: (typeof kits)[number]; parents: string[]; parentNames: string[]; parentQty: number }
  >()
  for (const kit of kits) {
    if (kit.suppressIfOrdered && orderedIds.has(kit.pieceItemId)) continue
    const qty = parentQty.get(kit.parentItemId) ?? 0
    if (qty <= 0) continue
    const key = [
      kit.pieceItemId,
      kit.qtyPer.toString(),
      kit.perUnits,
      kit.rounding,
      kit.minQty,
      kit.billing,
    ].join('|')
    const g = groups.get(key)
    const parentName = kit.parent.description || kit.parent.code
    if (g) {
      g.parents.push(kit.parentItemId)
      g.parentNames.push(parentName)
      g.parentQty += qty
    } else {
      groups.set(key, {
        kit,
        parents: [kit.parentItemId],
        parentNames: [parentName],
        parentQty: qty,
      })
    }
  }

  const out: KitPieceLine[] = []
  for (const { kit, parents, parentNames, parentQty: total } of groups.values()) {
    const quantity = resolveKitQuantity(
      {
        qtyPer: Number(kit.qtyPer),
        perUnits: kit.perUnits,
        rounding: kit.rounding,
        minQty: kit.minQty,
      },
      total,
    )
    if (quantity <= 0) continue
    out.push({
      kitPieceId: kit.id,
      pieceItemId: kit.pieceItemId,
      description: kit.piece.description || kit.piece.code,
      code: kit.piece.code,
      quantity,
      rate: kit.billing === 'CHARGED' ? Number(kit.piece.dailyRate) : 0,
      billing: kit.billing,
      department: kit.piece.department,
      lineType: kit.piece.type,
      clientVisible: kit.clientVisible,
      note: kit.note?.trim() || defaultKitNote(kit.billing, total, parentNames),
      parentItemIds: parents,
    })
  }
  return out
}

/**
 * The line's own explanation. Auto-added lines are the ones a rep is
 * most likely to read as a parser bug, so every one of them says where
 * it came from and whether it costs anything.
 */
function defaultKitNote(
  billing: KitPieceBilling,
  parentQty: number,
  parentNames: string[],
): string {
  const with_ =
    parentNames.length === 1
      ? `${parentQty} × ${parentNames[0]}`
      : `${parentQty} units across ${parentNames.length} items`
  return billing === 'CHARGED'
    ? `Included with ${with_} — billed at catalog rate`
    : `Included with ${with_} — no charge`
}
