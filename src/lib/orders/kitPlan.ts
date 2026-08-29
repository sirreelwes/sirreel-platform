/**
 * The reconcile DECISION for included accessories — no database.
 *
 * Split out of kitSync.ts the same way kitMath.ts was split out of
 * kitPieces.ts: the arithmetic that decides whether a spare battery is
 * created, resized, left alone, or deleted is the part that can quietly
 * go wrong, and it should be testable without standing up an order.
 *
 * The rules here are all about NOT destroying things:
 *   - only lines the reconciler created are ever candidates (the caller
 *     filters on autoKitPieceId before calling in);
 *   - a piece that is no longer owed but has already been physically
 *     picked is KEPT, because deleting it erases the warehouse's only
 *     record of gear that left the building.
 */

export interface ManagedLine {
  id: string
  /** The InventoryKitPiece that generated it. */
  autoKitPieceId: string
  quantity: number
  parentLineItemId: string | null
  /** Null or PENDING_PICK = still on the shelf. Anything else means
   *  someone physically moved it. */
  pickStatus: string | null
}

export interface DesiredPiece {
  kitPieceId: string
  quantity: number
  /** Which line it should hang under; null when no parent line matched. */
  anchorLineId: string | null
}

export type KitAction =
  | { kind: 'create'; kitPieceId: string; quantity: number; anchorLineId: string | null }
  | { kind: 'resize'; lineId: string; from: number; to: number; anchorLineId: string | null }
  | { kind: 'renest'; lineId: string; anchorLineId: string | null }
  | { kind: 'remove'; lineId: string; quantity: number }
  /** Owed no longer, but already picked — left in place, reported up. */
  | { kind: 'keep-picked'; lineId: string; quantity: number }

/**
 * What to do to bring `managed` in line with `desired`.
 *
 * Matching is on the KIT ROW id, never the inventory item: two parents
 * can owe the same battery under different ratios, and those are two
 * separate promises that must not collapse into one line.
 */
export function planKitReconcile(
  managed: ManagedLine[],
  desired: DesiredPiece[],
): KitAction[] {
  const wanted = new Map(desired.map((d) => [d.kitPieceId, d]))
  const actions: KitAction[] = []

  for (const line of managed) {
    const want = wanted.get(line.autoKitPieceId)

    if (!want) {
      if (line.pickStatus && line.pickStatus !== 'PENDING_PICK') {
        actions.push({ kind: 'keep-picked', lineId: line.id, quantity: line.quantity })
      } else {
        actions.push({ kind: 'remove', lineId: line.id, quantity: line.quantity })
      }
      continue
    }

    // Claimed — whatever is left in the map at the end is genuinely new.
    wanted.delete(line.autoKitPieceId)

    if (line.quantity !== want.quantity) {
      actions.push({
        kind: 'resize',
        lineId: line.id,
        from: line.quantity,
        to: want.quantity,
        anchorLineId: want.anchorLineId,
      })
    } else if ((line.parentLineItemId ?? null) !== want.anchorLineId) {
      // Same count, different home: the bigger radio line changed and
      // the bank should sit under it now.
      actions.push({ kind: 'renest', lineId: line.id, anchorLineId: want.anchorLineId })
    }
  }

  for (const want of wanted.values()) {
    actions.push({
      kind: 'create',
      kitPieceId: want.kitPieceId,
      quantity: want.quantity,
      anchorLineId: want.anchorLineId,
    })
  }

  return actions
}

/**
 * Which line an accessory hangs under.
 *
 * A piece can be owed by several parents at once — analog and digital
 * radios share one charging bank between them — and it can only nest
 * under one. The largest contributor wins: on a quote reading "20
 * analog radios / 2 digital", the bank belongs under the twenty.
 *
 * Ties break on the first line in sort order, so the choice is stable
 * across saves rather than flipping on every reconcile.
 */
export function pickAnchorLine(
  parentItemIds: string[],
  sourceLines: Array<{ id: string; inventoryItemId: string | null; quantity: number }>,
): string | null {
  let best: { id: string; qty: number } | null = null
  for (const l of sourceLines) {
    if (!l.inventoryItemId) continue
    if (!parentItemIds.includes(l.inventoryItemId)) continue
    if (!best || l.quantity > best.qty) best = { id: l.id, qty: l.quantity }
  }
  return best?.id ?? null
}
