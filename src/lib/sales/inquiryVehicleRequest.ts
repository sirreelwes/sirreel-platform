/**
 * What a web-form inquiry actually ASKED FOR, read as a reservation.
 *
 * Wes 2026-09-10: "we need to add the workflow of starting with making
 * a reservation and quote following if vehicles are on the request."
 * Capture & Quote builds the quote first and the hold falls out of it
 * at the end; on a request that already names trucks and dates, the
 * truck is the scarce thing and the money is the easy part. This reads
 * the cart the public order form stored on the Inquiry so the
 * reservation desk can open pre-loaded and the quote can follow on the
 * order it creates.
 *
 * TWO ID SPACES, and mixing them books nothing. A cart VEHICLE line
 * points at a `VehicleCategory` (the public catalog row). Quotes bind
 * to its merged catalog item — that's `assetCategoryId` on the
 * enriched cart, misleading name and all. A HOLD binds to the fleet
 * `AssetCategory`, which is `fleetCategoryId` (added alongside by
 * GET /api/inquiries/[id]). Only the latter is a reservation target,
 * and only the detail route enriches it — the list payload carries the
 * raw cart, which is why `vehicleLineCount` below asks a smaller
 * question than `readVehicleRequest`.
 */

/** The public order form's cart snapshot, as far as we read it. */
export interface CartLine {
  itemKind?: string
  itemId?: string
  name?: string
  qty?: number
  quantity?: number
  unitPrice?: number
  days?: number
  type?: string
  pickupDate?: string
  returnDate?: string
  /** Merged catalog id — the QUOTE's target. Enriched server-side. */
  assetCategoryId?: string | null
  /** Fleet AssetCategory id — the HOLD's target. Enriched server-side. */
  fleetCategoryId?: string | null
  /** InventoryItem department, for supply lines. Enriched server-side. */
  department?: string | null
}

interface RequestMetadata {
  kind?: string
  cart?: CartLine[]
  window?: { start?: string; end?: string }
  dates?: { start?: string; end?: string }
  contact?: { name?: string; email?: string; phone?: string }
  production?: { companyName?: string; jobName?: string }
  notes?: string | null
}

/** Both strings the public form has written over its life. */
function isOrderForm(meta: unknown): meta is RequestMetadata {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false
  const k = (meta as RequestMetadata).kind
  return k === 'production-order' || k === 'supply-order'
}

/**
 * How many vehicles are on this request — the question the inbound
 * CARD can answer, because it only needs the raw cart the list route
 * already returns. Returns 0 for anything that isn't an order-form
 * inquiry.
 */
export function vehicleLineCount(meta: unknown): number {
  if (!isOrderForm(meta) || !Array.isArray(meta.cart)) return 0
  return meta.cart
    .filter((l) => l.itemKind === 'VEHICLE')
    .reduce((n, l) => n + Math.max(1, Math.floor(l.qty ?? l.quantity ?? 1)), 0)
}

export interface VehicleRequestLine {
  /** AssetCategory id — null when the catalog row isn't fleet-linked. */
  fleetCategoryId: string | null
  name: string
  quantity: number
}

export interface SupplyRequestLine {
  inventoryItemId: string
  name: string
  quantity: number
  /** The snapshot's own `type`, which is `InventoryItem.type` — a
   *  LineItemType already, so it goes to the line-items route as-is
   *  rather than being flattened to "supply". */
  type: string
  /** EXPENDABLE bills flat (qty × rate); everything else is daily. */
  flat: boolean
  department: string | null
  rate: number
  pickupDate: string | null
  returnDate: string | null
}

export interface VehicleRequest {
  vehicles: VehicleRequestLine[]
  /** Non-vehicle lines on the same request. They can't be held, but
   *  they were asked for, so they ride onto the same order. */
  supplies: SupplyRequestLine[]
  start: string | null
  end: string | null
  contact: { firstName: string; lastName: string; email: string; phone: string | null } | null
  companyName: string | null
  jobName: string | null
  notes: string | null
}

const iso = (v: unknown): string | null =>
  typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null

/**
 * Split a typed contact name into first + last. The form collects ONE
 * name field, and the reservation desk needs both — an empty surname
 * fails the modal's contact check and the hold never gets created (the
 * Wild Goats failure). Everything after the first token is the
 * surname; a single-word name keeps the modal asking rather than
 * inventing one.
 */
function splitName(name: string | undefined): { firstName: string; lastName: string } | null {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

/**
 * The full read, against the ENRICHED cart from GET
 * /api/inquiries/[id]. Vehicles whose catalog row has no fleet
 * category come back with `fleetCategoryId: null` rather than being
 * dropped — the desk has to see that the truck the client asked for
 * isn't a type we can hold, not just find it missing.
 */
export function readVehicleRequest(
  meta: unknown,
  fallback: { start?: string | null; end?: string | null } = {},
): VehicleRequest | null {
  if (!isOrderForm(meta) || !Array.isArray(meta.cart) || meta.cart.length === 0) return null

  const vehicles: VehicleRequestLine[] = []
  const supplies: SupplyRequestLine[] = []
  for (const l of meta.cart) {
    const quantity = Math.max(1, Math.floor(l.qty ?? l.quantity ?? 1))
    if (l.itemKind === 'VEHICLE') {
      vehicles.push({
        fleetCategoryId: l.fleetCategoryId ?? null,
        name: l.name || 'Vehicle',
        quantity,
      })
    } else if (l.itemId) {
      supplies.push({
        inventoryItemId: String(l.itemId),
        name: l.name || 'Item',
        quantity,
        type: l.type || 'EQUIPMENT',
        flat: l.type === 'EXPENDABLE',
        department: l.department ?? null,
        rate: typeof l.unitPrice === 'number' ? l.unitPrice : 0,
        pickupDate: iso(l.pickupDate),
        returnDate: iso(l.returnDate),
      })
    }
  }
  if (vehicles.length === 0) return null

  const start = iso(meta.window?.start) ?? iso(meta.dates?.start) ?? iso(fallback.start)
  const end = iso(meta.window?.end) ?? iso(meta.dates?.end) ?? iso(fallback.end) ?? start

  return {
    vehicles,
    supplies,
    start,
    end,
    contact: (() => {
      const split = splitName(meta.contact?.name)
      const email = meta.contact?.email?.trim() || ''
      if (!split || !email) return null
      // The phone rides along to the Job's contact (Wes 2026-09-10: the
      // job forgot what the request said) — it is not a modal field.
      return { ...split, email, phone: meta.contact?.phone?.trim() || null }
    })(),
    companyName: meta.production?.companyName?.trim() || null,
    jobName: meta.production?.jobName?.trim() || null,
    notes: meta.notes?.trim() || null,
  }
}

/**
 * ONE LINE PER TYPE is the reservation modal's rule (two lines of one
 * category make the second one's capacity check trip over the hold the
 * first just took). A cart can legitimately list the same van twice —
 * two separate adds in the shop — so fold them here rather than
 * handing the modal a form it will refuse to submit.
 */
export function foldByCategory(lines: VehicleRequestLine[]): VehicleRequestLine[] {
  const out: VehicleRequestLine[] = []
  for (const l of lines) {
    const hit = l.fleetCategoryId
      ? out.find((o) => o.fleetCategoryId === l.fleetCategoryId)
      : undefined
    if (hit) hit.quantity += l.quantity
    else out.push({ ...l })
  }
  return out
}
