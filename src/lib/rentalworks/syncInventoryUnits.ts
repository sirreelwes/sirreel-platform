import { prisma } from '@/lib/prisma'
import { isNonRentalRwCode } from '@/lib/catalog/nonRentalStock'
import { rwFetch, isRwAuthError } from '@/lib/rentalworks/rwClient'

/**
 * Mirror RentalWorks' per-unit register into `sr_inventory_units`
 * (barcode phase 1 — Wes, 2026-09-02: "do phases 1 and 2").
 *
 * `GET /api/v1/item` is NOT a catalog endpoint despite the name — every
 * row is one physical, barcoded thing: barcode, serial, status, shelf,
 * and the contract it last moved on. That register is the only place
 * SirReel's barcodes exist; HQ's own warehouse model is line-and-quantity
 * throughout (see the InventoryUnit schema note).
 *
 * Deliberately UPSERT, never replace-the-table (which is what
 * syncInvoices does):
 *   - The invoice mirror is a pure projection with nothing hanging off
 *     it. A unit row is a physical object's identity and other rows will
 *     come to reference it; deleting and re-inserting would churn the
 *     ids under them every night.
 *   - RW RETIRES units rather than removing them (204 at first sync), so
 *     a row vanishing from the feed is a question, not a licence to
 *     delete. Missing rows keep their `lastSeenAt` and are reported.
 *
 * Catalog resolution happens HERE rather than on read: RW's ICode is
 * matched against InventoryItem.rwICode (backfilled 2026-06-23) and
 * stored as `inventoryItemId`, so the scan resolver is one indexed hit
 * instead of a two-hop join on every scan. A null means RW has an item
 * HQ's catalog has never heard of — 11 such codes at first sync — and is
 * reported as `unmatchedICodes` so someone can reconcile them.
 *
 * Auth failures propagate (RwAuthError) rather than being folded into a
 * result — the house rule from rwClient: a dead credential must not look
 * like an empty inventory.
 */

const PAGE_SIZE = 500
const MAX_PAGES = 40 // 20k units — backstop; the register is ~1.8k

/** One row of RW's item register. Everything is optional but ItemId. */
interface RwUnit {
  ItemId?: string
  BarCode?: string
  BarCodeForScanning?: string
  SerialNumber?: string
  RfId?: string
  ICode?: string
  Description?: string
  InventoryStatus?: string
  StatusType?: string
  Warehouse?: string
  AisleLocation?: string
  ShelfLocation?: string
  CurrentLocation?: string
  InventoryType?: string
  Category?: string
  SubCategory?: string
  UnitValue?: number
  ReplacementCost?: number
  CurrentOrderNumber?: string
  LastOutContractNumber?: string
  LastOutContractDate?: string
  LastInContractNumber?: string
  LastInContractDate?: string
  Inactive?: boolean
}

export interface InventoryUnitSyncResult {
  ok: boolean
  /** Units returned by RW across all pages. */
  pulled: number
  /** Rows written (created + updated). */
  written: number
  created: number
  /** Rows in HQ that RW did NOT return this run — reported, never deleted. */
  stale: number
  /** Units whose ICode matched no HQ catalog row — EXCLUDING the gear
   *  that is deliberately not rental inventory (lib/catalog/nonRentalStock).
   *  Reporting the truck jump starters as unmatched every morning is how a
   *  real unmatched code stops being noticed. */
  unmatched: number
  /** The distinct unmatched ICodes, so the report names what to fix. */
  unmatchedICodes: string[]
  /** Units that DID match a catalog row — one nobody can order, because
   *  it is archived. The quiet half of the same failure: `unmatched`
   *  reads zero while the barcode still has nowhere to land on a check
   *  sheet. Three codes were sitting here on 2026-09-18, one of them
   *  (the misters) since the 2026-09-13 dedupe named it.
   *  Fix by pointing the ICode at the live row —
   *  scripts/link-barcoded-catalog-rows.ts. */
  stranded: number
  strandedICodes: string[]
  /** Codes on the non-rental list — reported so the number stays visible,
   *  never as something to fix. */
  notRentalStockICodes: string[]
  pages: number
  error?: string
}

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length ? t : null
}

/** RW sends "" for an absent date as often as it omits the key. */
const date = (v: unknown): Date | null => {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

export async function syncInventoryUnits(): Promise<InventoryUnitSyncResult> {
  const empty = {
    pulled: 0, written: 0, created: 0, stale: 0,
    unmatched: 0, unmatchedICodes: [] as string[],
    stranded: 0, strandedICodes: [] as string[],
    notRentalStockICodes: [] as string[], pages: 0,
  }

  // ── 1. Pull the whole register into memory first. A partial pull must
  //       never be written: half a register looks exactly like a
  //       warehouse that lost 900 items overnight.
  const units: RwUnit[] = []
  let pages = 0
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await rwFetch(`/api/v1/item?pageno=${page}&pagesize=${PAGE_SIZE}`)
      if (!res.ok) {
        return { ok: false, ...empty, pages, error: `RW HTTP ${res.status}` }
      }
      const body = (await res.json().catch(() => null)) as
        | { Items?: RwUnit[]; TotalItems?: number }
        | null
      if (!body || !Array.isArray(body.Items)) {
        return { ok: false, ...empty, pages, error: 'unexpected RW response shape' }
      }
      pages = page
      units.push(...body.Items)
      const total = typeof body.TotalItems === 'number' ? body.TotalItems : null
      if (body.Items.length < PAGE_SIZE) break
      if (total !== null && units.length >= total) break
    }
  } catch (e) {
    if (isRwAuthError(e) || (e as Error)?.name === 'RwNoCredentialError') throw e
    return { ok: false, ...empty, pages, error: `network: ${(e as Error).message}` }
  }

  // A unit with no ItemId has no stable identity — there is nothing to
  // upsert against, and inventing one would create a duplicate on every
  // run. Skipped rather than guessed at.
  const usable = units.filter((u) => str(u.ItemId) && str(u.BarCode))

  // ── 2. Resolve RW ICode → HQ catalog row, once for the whole run.
  const icodes = [...new Set(usable.map((u) => str(u.ICode)).filter((c): c is string => !!c))]
  const catalog = await prisma.inventoryItem.findMany({
    where: { rwICode: { in: icodes } },
    select: { id: true, rwICode: true, archivedAt: true },
  })
  // Several catalog rows can share an ICode (colour variants). An
  // ORDERABLE row always wins; among equals, first wins — the join
  // exists to name the PRODUCT for a scan, and the variants are the same
  // product to a picker.
  //
  // The archived clause is not cosmetic. Resolving to an archived row
  // makes the unit unscannable onto any line anyone can book: nobody can
  // order that product, so the barcode has nowhere to land. That is how
  // 43 units ended up stranded on 4 archived rows (2026-09-13), and how
  // the misters and the Magliner Sr w/ shelf were still stranded on
  // 2026-09-18. `findMany` has no inherent order, so leaving it to "first
  // wins" makes which row owns a barcode a coin flip per run.
  const byICode = new Map<string, string>()
  for (const c of [...catalog].sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt))) {
    if (c.rwICode && !byICode.has(c.rwICode)) byICode.set(c.rwICode, c.id)
  }
  const unmatchedICodes = icodes
    .filter((c) => !byICode.has(c) && !isNonRentalRwCode(c))
    .sort()
  // Ours, barcoded, and never rented — shop kit. An answer, not a gap.
  const notRentalStockICodes = icodes.filter((c) => isNonRentalRwCode(c)).sort()
  // Matched, but to a row nobody can book. Counted separately so a run
  // cannot report "every unit resolved" while the gear is unscannable.
  const archivedIds = new Set(catalog.filter((c) => c.archivedAt).map((c) => c.id))
  const strandedICodes = icodes
    .filter((c) => {
      if (isNonRentalRwCode(c)) return false
      const id = byICode.get(c)
      return !!id && archivedIds.has(id)
    })
    .sort()

  // ── 3. Write. Sequential upserts: ~1.8k rows once a night is not worth
  //       the complexity of a batched raw INSERT ... ON CONFLICT, and a
  //       per-row failure here should not roll back the whole register.
  const runAt = new Date()
  const existing = new Set(
    (await prisma.inventoryUnit.findMany({ select: { rwItemId: true } })).map((r) => r.rwItemId),
  )

  let written = 0
  let created = 0
  let unmatched = 0
  const seen = new Set<string>()

  for (const u of usable) {
    const rwItemId = str(u.ItemId)!
    const barcode = str(u.BarCode)!
    const rwICode = str(u.ICode) ?? ''
    const inventoryItemId = byICode.get(rwICode) ?? null
    // Shop kit counts as answered, not unmatched — see nonRentalStock.ts.
    if (!inventoryItemId && !isNonRentalRwCode(rwICode)) unmatched++

    const data = {
      barcode,
      barcodeForScanning: str(u.BarCodeForScanning),
      serialNumber: str(u.SerialNumber),
      rfId: str(u.RfId),
      rwICode,
      inventoryItemId,
      description: str(u.Description),
      status: str(u.InventoryStatus),
      statusType: str(u.StatusType),
      warehouse: str(u.Warehouse),
      aisleLocation: str(u.AisleLocation),
      shelfLocation: str(u.ShelfLocation),
      currentLocation: str(u.CurrentLocation),
      inventoryType: str(u.InventoryType),
      category: str(u.Category),
      subCategory: str(u.SubCategory),
      unitValue: num(u.UnitValue),
      replacementCost: num(u.ReplacementCost),
      currentOrderNumber: str(u.CurrentOrderNumber),
      lastOutContractNumber: str(u.LastOutContractNumber),
      lastOutContractDate: date(u.LastOutContractDate),
      lastInContractNumber: str(u.LastInContractNumber),
      lastInContractDate: date(u.LastInContractDate),
      inactive: u.Inactive === true,
      lastSeenAt: runAt,
    }

    try {
      await prisma.inventoryUnit.upsert({
        where: { rwItemId },
        create: { rwItemId, ...data },
        update: data,
      })
      written++
      if (!existing.has(rwItemId)) created++
      seen.add(rwItemId)
    } catch (err) {
      // A barcode collision is the realistic failure: RW allows a label
      // to be reprinted onto a different unit, which our unique index
      // refuses. Report it rather than aborting the register.
      console.error('[rw-units] upsert failed for', rwItemId, barcode, err)
    }
  }

  const stale = [...existing].filter((id) => !seen.has(id)).length
  const strandedSet = new Set(strandedICodes)
  const stranded = usable.filter((u) => {
    const c = str(u.ICode)
    return !!c && strandedSet.has(c) && !u.Inactive
  }).length
  if (strandedICodes.length) {
    console.warn(
      `[rw-units] ${stranded} unit(s) on ${strandedICodes.length} ICode(s) resolve to an ARCHIVED catalog row ` +
      `(${strandedICodes.join(', ')}) — unscannable until the ICode points at a live row.`,
    )
  }

  return {
    ok: true,
    pulled: units.length,
    written,
    created,
    stale,
    unmatched,
    unmatchedICodes,
    stranded,
    strandedICodes,
    notRentalStockICodes,
    pages,
  }
}
