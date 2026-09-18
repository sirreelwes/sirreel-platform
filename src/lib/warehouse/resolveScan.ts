import { prisma } from '@/lib/prisma'
import { orderCodeForStockCode } from '@/lib/catalog/stockFills'
import { nonRentalStockFor } from '@/lib/catalog/nonRentalStock'

/**
 * Turn whatever a scanner (or a picker's keyboard) put in the box into a
 * catalog row — barcode phase 2.
 *
 * The picking floor has had a scan input since Phase 2 of the warehouse
 * work, and it only ever matched `InventoryItem.code`, HQ's PRODUCT key.
 * The labels on the actual gear carry `SR004674`, a per-UNIT barcode
 * that lives in RentalWorks. So scanning a real label at HQ produced
 * "scan mismatch" — the box looked like it worked and could not.
 *
 * This resolver closes that: a scan is tried as a catalog code first
 * (nothing that worked before stops working), then as a unit barcode via
 * the mirrored register (`InventoryUnit`, synced nightly).
 *
 * Normalisation is deliberately narrow. Code 39 labels are printed
 * `*SR004674*` and some wedge scanners emit the asterisks with the
 * payload, so those are stripped; case is folded because scanners and
 * humans disagree about it. Nothing else is "cleaned" — a code that
 * differs by more than that is a different code, and quietly matching it
 * to the nearest thing is how the wrong item gets picked.
 */

export type ScanResolution =
  | {
      kind: 'catalog'
      /** The catalog row this scan names. */
      inventoryItemId: string
      code: string
      /** Normalised scan, as it should be recorded. */
      scanned: string
    }
  | {
      kind: 'unit'
      inventoryItemId: string
      code: string | null
      scanned: string
      unit: {
        id: string
        barcode: string
        description: string | null
        status: string | null
        rwICode: string
      }
    }
  | {
      /** A real barcode in the register, but on gear HQ's catalog has
       *  never been matched to. Distinct from 'unknown' because the fix
       *  is different: reconcile the item, don't re-scan. */
      kind: 'unlinked-unit'
      scanned: string
      unit: { id: string; barcode: string; description: string | null; rwICode: string }
    }
  | { kind: 'unknown'; scanned: string }

/**
 * Strip the Code 39 delimiters and fold case. Exported for the tests and
 * for callers that need to record what was actually scanned.
 */
export function normalizeScan(raw: string): string {
  const trimmed = raw.trim()
  // Only strip asterisks when they wrap the WHOLE payload — a lone
  // leading `*` is a malformed read, not a delimiter, and should fail.
  const unwrapped =
    trimmed.length > 2 && trimmed.startsWith('*') && trimmed.endsWith('*')
      ? trimmed.slice(1, -1)
      : trimmed
  return unwrapped.trim().toUpperCase()
}

export async function resolveScan(raw: string): Promise<ScanResolution> {
  const scanned = normalizeScan(raw)
  if (!scanned) return { kind: 'unknown', scanned }

  // 1. Catalog code. `code` is not stored uppercase (it is a mix of
  //    numeric RW I-codes and descriptive names like `1" SQUARE
  //    COUPLER`), so match case-insensitively rather than on the
  //    normalised form.
  const item = await prisma.inventoryItem.findFirst({
    where: { code: { equals: scanned, mode: 'insensitive' } },
    select: { id: true, code: true },
  })
  if (item) {
    const orderable = await orderableRow(item)
    return { kind: 'catalog', inventoryItemId: orderable.id, code: orderable.code ?? item.code, scanned }
  }

  // 2. Unit barcode from the mirrored RW register.
  const unit = await prisma.inventoryUnit.findUnique({
    where: { barcode: scanned },
    select: {
      id: true,
      barcode: true,
      description: true,
      status: true,
      rwICode: true,
      inventoryItemId: true,
      inventoryItem: { select: { code: true } },
    },
  })
  if (unit) {
    if (!unit.inventoryItemId) {
      return {
        kind: 'unlinked-unit',
        scanned,
        unit: {
          id: unit.id,
          barcode: unit.barcode,
          description: unit.description,
          rwICode: unit.rwICode,
        },
      }
    }
    const orderable = await orderableRow({ id: unit.inventoryItemId, code: unit.inventoryItem?.code ?? null })
    return {
      kind: 'unit',
      inventoryItemId: orderable.id,
      code: orderable.code,
      scanned,
      unit: {
        id: unit.id,
        barcode: unit.barcode,
        description: unit.description,
        status: unit.status,
        rwICode: unit.rwICode,
      },
    }
  }

  return { kind: 'unknown', scanned }
}

/**
 * A stock-only row answers as the row its orders are written against.
 *
 * Walkies: every walkie line binds to the "Motorola CP200" row, but the
 * shelf holds analog radios under their own RentalWorks I-code. MiFis:
 * every line binds to "Mobile Internet MiFi" while the shelf holds
 * T-Mobile and Verizon hotspots. Without this, a picker grabbing an
 * analog radio — or whichever carrier has coverage at that location —
 * would be told "this line expects something else"; the floor decides
 * which one goes out, not the order. The unit itself (id, barcode) is
 * untouched, so the scan still records exactly which one left.
 *
 * The pairs live in lib/catalog/stockFills.ts.
 */
async function orderableRow<T extends { id: string; code: string | null }>(
  row: T,
): Promise<{ id: string; code: string | null }> {
  const orderCode = orderCodeForStockCode(row.code)
  if (!orderCode) return row
  const target = await prisma.inventoryItem.findFirst({
    where: { code: orderCode, isActive: true },
    select: { id: true, code: true },
  })
  return target ?? row
}

/**
 * The message a picker should see when a scan does not land on a line.
 * Kept beside the resolver so every caller says the same thing, and so
 * the four outcomes stay distinguishable — "not on this list" and "we
 * have never heard of this label" need different reactions from whoever
 * is standing at the shelf.
 */
export function describeUnlanded(
  res: ScanResolution,
  ctx: { onListButPicked: boolean },
): string {
  if (res.kind === 'unknown') {
    return `${res.scanned} isn't a code or a barcode we know. Check the label, or use the manual tick.`
  }
  if (res.kind === 'unlinked-unit') {
    // Some unlinked gear is unlinked on purpose — the jump starters that
    // live on the trucks are ours and barcoded and have no catalog row
    // because they never go on an order (lib/catalog/nonRentalStock).
    // Telling the floor to "flag it" sends them after a row nobody is
    // going to create.
    const shopKit = nonRentalStockFor(res.unit.rwICode)
    if (shopKit) {
      return `${res.scanned} is ${shopKit.what.toLowerCase()} — ours, but not rental stock, so it doesn't go on an order.`
    }
    return `${res.scanned} is ${res.unit.description ?? 'a known unit'} (RW item ${res.unit.rwICode}), but it isn't matched to anything in the HQ catalog yet — pick it manually and flag it.`
  }
  const what = res.kind === 'unit'
    ? `${res.scanned}${res.unit.description ? ` (${res.unit.description})` : ''}`
    : res.scanned
  return ctx.onListButPicked
    ? `All ${what} on this list are already picked.`
    : `${what} isn't on this list.`
}
