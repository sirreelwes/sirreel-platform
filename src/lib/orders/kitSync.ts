/**
 * Included-accessory reconciliation for an order's line items.
 *
 * The catalog knows what rides along with what (InventoryKitPiece: spare
 * batteries and a charging bank with walkies, bulbs with a makeup mirror).
 * Until now that knowledge was applied in exactly ONE place — the AI
 * quote parser — so a rep who typed "12 walkies" into the line-item
 * combobox by hand got twelve radios and no batteries, and nobody found
 * out until the truck was at the location.
 *
 * This module is the reconciler. It runs after any mutation that can
 * change what kits are owed — a line added, a quantity edited, a line
 * removed, a package expanded — and brings the order's auto-added
 * accessory lines back in line with the catalog.
 *
 * ── Provenance, not inference ──────────────────────────────────────
 * Only lines carrying `autoKitPieceId` are managed here. That column is
 * the whole safety story: a spare battery the CLIENT ordered looks
 * identical to one the kit added — same inventoryItemId, same
 * description — and the difference decides whether a radio quantity
 * edit is allowed to delete it. Matching on inventoryItemId (which is
 * what the older parse path did to spot kit lines) answers "could this
 * have come from a kit", which is a different question.
 *
 * So: this reconciler never touches a line it did not create. A kit
 * that gets unconfigured leaves its already-quoted lines alone —
 * `onDelete: SetNull` on the FK means the line survives and simply
 * stops being managed. Gear already on a truck does not vanish from an
 * order because someone edited the catalog.
 *
 * ── Nesting ────────────────────────────────────────────────────────
 * Kit lines hang under their parent line via `parentLineItemId`, the
 * same sub-item mechanism partner ancillaries use. Wes's framing is
 * "the items underneath each rental item" — a flat list of accessories
 * at the bottom of a quote reads as clutter the client didn't ask for;
 * indented under the radios, it reads as what's included.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { deriveKitPieceLines, type KitPieceLine } from '@/lib/inventory/kitPieces'
import { computeLineTotal } from '@/lib/orders/billing'
import { syncPickListOnLineAdd } from '@/lib/orders/pickListSync'
import { planKitReconcile, pickAnchorLine, type DesiredPiece } from '@/lib/orders/kitPlan'

type TxClient = PrismaClient | Prisma.TransactionClient

export interface KitSyncResult {
  created: Array<{ lineItemId: string; description: string; quantity: number }>
  /** Quantity moved because the parent count changed. */
  resized: Array<{ lineItemId: string; description: string; from: number; to: number }>
  /** The parent went away, or the client ordered the piece themselves. */
  removed: Array<{ lineItemId: string; description: string; quantity: number }>
  /** Owed no longer, but already picked — left on the order and
   *  reported so a human at the truck decides, rather than silently
   *  deleting the record of gear that physically left. */
  keptPicked: Array<{ lineItemId: string; description: string; quantity: number }>
  /** True when nothing about the order's kits changed — the common case. */
  noop: boolean
}

const EMPTY: KitSyncResult = { created: [], resized: [], removed: [], keptPicked: [], noop: true }

/**
 * Bring `orderId`'s auto-added accessory lines in line with the catalog.
 *
 * Safe to call after every line mutation: with no kits configured (the
 * state of the catalog today) it costs one indexed query and returns a
 * noop. Callers do not need to know whether anything has a kit.
 *
 * Returns what changed so the caller can audit it and tell the rep —
 * an accessory line appearing on its own is the kind of thing that
 * reads as a bug when it is unannounced.
 */
export async function syncOrderKitPieces(
  tx: TxClient,
  orderId: string,
): Promise<KitSyncResult> {
  const lines = await tx.orderLineItem.findMany({
    where: { orderId },
    select: {
      id: true,
      inventoryItemId: true,
      autoKitPieceId: true,
      parentLineItemId: true,
      quantity: true,
      description: true,
      rate: true,
      rateType: true,
      billableDays: true,
      computedDays: true,
      pickupDate: true,
      returnDate: true,
      sortOrder: true,
      pickStatus: true,
      type: true,
    },
    orderBy: { sortOrder: 'asc' },
  })
  if (lines.length === 0) return EMPTY

  // Lines the kit is sized AGAINST. Auto-added accessories are excluded
  // so a kit can never feed itself — a battery that is itself a parent
  // of something would otherwise grow on every save.
  const sourceLines = lines.filter((l) => !l.autoKitPieceId)
  const managed = lines.filter((l) => l.autoKitPieceId)

  // The order's client, so a CHARGED accessory bills at their negotiated
  // rate rather than list. This is the path that prices auto-added kit
  // pieces — the parse preview quotes list and is corrected here.
  const orderForRates = await tx.order.findUnique({
    where: { id: orderId },
    select: { companyId: true },
  })

  const desired = await deriveKitPieceLines(
    sourceLines.map((l) => ({
      inventoryItemId: l.inventoryItemId,
      quantity: l.quantity,
    })),
    tx,
    orderForRates?.companyId ?? null,
  )

  // Nothing owed and nothing managed — the overwhelmingly common path.
  if (desired.length === 0 && managed.length === 0) return EMPTY

  // Resolve each desired piece to the line it should hang under before
  // planning, so the planner stays pure.
  const byKit = new Map<string, KitPieceLine>()
  const desiredPlan: DesiredPiece[] = desired.map((d) => {
    byKit.set(d.kitPieceId, d)
    return {
      kitPieceId: d.kitPieceId,
      quantity: d.quantity,
      anchorLineId: pickAnchorLine(d.parentItemIds, sourceLines),
    }
  })

  const actions = planKitReconcile(
    managed.map((l) => ({
      id: l.id,
      autoKitPieceId: l.autoKitPieceId!,
      quantity: l.quantity,
      parentLineItemId: l.parentLineItemId,
      pickStatus: l.pickStatus,
    })),
    desiredPlan,
  )
  if (actions.length === 0) return EMPTY

  const lineById = new Map(managed.map((l) => [l.id, l]))
  const result: KitSyncResult = {
    created: [],
    resized: [],
    removed: [],
    keptPicked: [],
    noop: false,
  }

  for (const action of actions) {
    switch (action.kind) {
      case 'remove': {
        const line = lineById.get(action.lineId)!
        await tx.pickListItem.deleteMany({ where: { orderLineItemId: action.lineId } })
        await tx.orderLineItem.delete({ where: { id: action.lineId } })
        result.removed.push({
          lineItemId: action.lineId,
          description: line.description,
          quantity: action.quantity,
        })
        break
      }

      case 'keep-picked': {
        const line = lineById.get(action.lineId)!
        result.keptPicked.push({
          lineItemId: action.lineId,
          description: line.description,
          quantity: action.quantity,
        })
        break
      }

      case 'renest': {
        await tx.orderLineItem.update({
          where: { id: action.lineId },
          data: { parentLineItemId: action.anchorLineId },
        })
        break
      }

      case 'resize': {
        const line = lineById.get(action.lineId)!
        const want = byKit.get(line.autoKitPieceId!)!
        await tx.orderLineItem.update({
          where: { id: action.lineId },
          data: {
            quantity: action.to,
            parentLineItemId: action.anchorLineId,
            lineTotal: computeLineTotal({
              rate: Number(line.rate),
              quantity: action.to,
              billableDays: line.billableDays,
              rateType: line.rateType,
              department: want.department,
            }),
            notes: want.note,
          },
        })
        result.resized.push({
          lineItemId: action.lineId,
          description: line.description,
          from: action.from,
          to: action.to,
        })
        break
      }

      case 'create': {
        const want = byKit.get(action.kitPieceId)!
        const anchor =
          sourceLines.find((l) => l.id === action.anchorLineId) ?? sourceLines[0]
        if (!anchor) break

        const created = await tx.orderLineItem.create({
          data: {
            orderId,
            type: want.lineType,
            department: want.department,
            description: want.description,
            inventoryItemId: want.pieceItemId,
            autoKitPieceId: want.kitPieceId,
            parentLineItemId: action.anchorLineId,
            quantity: action.quantity,
            // Kit pieces ride on the parent's dates so an accessory can
            // never outlast the gear it belongs to.
            rateType: anchor.rateType,
            pickupDate: anchor.pickupDate,
            returnDate: anchor.returnDate,
            billableDays: anchor.billableDays,
            computedDays: anchor.computedDays,
            rate: want.rate,
            // A FREE piece at $0 is the configured price, not a staff
            // override — resolvedRate matches so the override audit
            // stays quiet. A CHARGED piece bills at its catalog rate.
            resolvedRate: want.rate,
            rateOverridden: false,
            lineTotal: computeLineTotal({
              rate: want.rate,
              quantity: action.quantity,
              billableDays: anchor.billableDays,
              rateType: anchor.rateType,
              department: want.department,
            }),
            notes: want.note,
            // Immediately after its parent, ahead of the next top-level row.
            sortOrder: anchor.sortOrder,
          },
          select: { id: true, description: true, quantity: true },
        })

        // Route it like any other line. This is the point of the whole
        // feature: an accessory that reaches the warehouse as a real
        // line is scannable on the pick list and countable on the way
        // back, which the old text-only kit never was.
        await syncPickListOnLineAdd(tx, {
          orderId,
          orderLineItemId: created.id,
          department: want.department,
        })

        result.created.push({
          lineItemId: created.id,
          description: created.description,
          quantity: created.quantity,
        })
        break
      }
    }
  }

  result.noop =
    result.created.length === 0 &&
    result.resized.length === 0 &&
    result.removed.length === 0
  return result
}
