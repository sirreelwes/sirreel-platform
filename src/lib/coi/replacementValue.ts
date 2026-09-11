/**
 * Replacement value of what an order puts in a client's hands — the figure
 * their broker needs.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The insurance requirements we send every client (requirements.ts) ask for
 * "Misc Rental Equipment OR Entertainment Package totaling the replacement
 * value of rented equipment". We never told anyone what that value WAS. The
 * production coordinator would ask, the agent would eyeball the order, and
 * the broker would write a limit off a guess. The number is derivable from
 * the order — the catalog carries a replacement cost per row, RentalWorks'
 * unit register carries one per barcode — so this derives it, says which
 * lines it could not value, and lets the desk fix those on the catalog row.
 *
 * ── Computed, never stored ──────────────────────────────────────────────────
 * Same rule as vehicleScope.ts: derived on READ from the lines that are on
 * the order right now. Adding a line raises the figure on the next read;
 * pricing a catalog row clears every order that was waiting on it. Nothing
 * to re-run, nothing to go stale.
 *
 * ── A short figure is worse than no figure ──────────────────────────────────
 * A broker writes the limit they are given. If two of ten lines carry no
 * replacement cost, the total is not "the total, roughly" — it is a floor,
 * and every surface that shows it says so ("at least $X, N items still
 * being valued"). `complete` is the flag those surfaces read; the missing
 * lines are listed so the desk can price them, and the action-items panel
 * raises one item per catalog row that is holding orders up.
 *
 * ── Where a line's value comes from (first hit wins) ────────────────────────
 *   unit      the SPECIFIC asset reserved for a vehicle line, when the fleet
 *             record carries a current value (or a purchase price)
 *   catalog   InventoryItem.replacementCost — the row the line was picked from
 *   register  the highest replacementCost across that row's RentalWorks units.
 *             The client can be handed any unit, so the most expensive one is
 *             the value at risk — never the average.
 *   fleet     for a vehicle line with no unit bound yet: the highest valued
 *             active asset in the class it holds
 *
 * ── What is counted ─────────────────────────────────────────────────────────
 * VEHICLE and EQUIPMENT lines, including included accessories (the client is
 * accountable for bringing a kit's batteries back). Not counted: fees,
 * discounts, labor, and EXPENDABLES — consumables are sold to the production,
 * not rented, and are not "rented equipment" on anyone's policy.
 *
 * A partner-fulfilled line (a sub-rented unit) IS rented equipment the
 * client is accountable for, but its value lives with the partner. It counts
 * when the catalog row it was quoted from carries a cost; otherwise it is
 * listed as missing with `partner: true` so the desk knows who to ask.
 */

import { prisma } from '@/lib/prisma'

/** Prisma Decimals, numbers, or strings — the loaders and the tests both feed this. */
type MoneyLike = { toString(): string } | number | string | null | undefined

export type ReplacementSource = 'unit' | 'catalog' | 'register' | 'fleet'

/** Structural, not Prisma types: every reader selects the subset it has. */
export interface ReplacementLineInput {
  id: string
  orderId?: string | null
  type?: string | null
  description: string
  quantity: number
  parentLineItemId?: string | null
  assetCategoryId?: string | null
  inventoryItem?: {
    id: string
    replacementCost?: MoneyLike
    legacyAssetCategoryId?: string | null
    /** Highest replacementCost across the row's RentalWorks units (loader-supplied). */
    registerCost?: MoneyLike
  } | null
  /** Existence only — a partner's unit fulfils the line. */
  subRentals?: ReadonlyArray<{ id: string }> | null
}

/** A unit bound to a hold on the job — the vehicle a line actually goes out on. */
export interface ReplacementAssignmentInput {
  orderId?: string | null
  status?: string | null
  asset: {
    id: string
    categoryId: string
    currentValue?: MoneyLike
    purchasePrice?: MoneyLike
  }
}

/** An active fleet unit, for the class-level fallback. */
export interface ReplacementFleetAssetInput {
  categoryId: string
  currentValue?: MoneyLike
  purchasePrice?: MoneyLike
}

export interface ReplacementValueContext {
  assignments?: ReadonlyArray<ReplacementAssignmentInput> | null
  fleetAssets?: ReadonlyArray<ReplacementFleetAssetInput> | null
}

export interface ReplacementLine {
  lineId: string
  orderId: string | null
  /** VEHICLE or EQUIPMENT — the provider ranks a truck above a power strip. */
  type: string
  description: string
  quantity: number
  /** Per-unit replacement cost, or null when nothing on file could value it. */
  each: number | null
  /** each × quantity, or null. */
  total: number | null
  source: ReplacementSource | null
  /** The catalog row to price when `each` is null (and the row exists). */
  inventoryItemId: string | null
  /** Fulfilled by a partner — the value has to come from them. */
  partner: boolean
}

export interface ReplacementValueSummary {
  /** Sum of every valued line. A FLOOR when `complete` is false. */
  total: number
  /** Every counted line carries a value. */
  complete: boolean
  /** Lines that count toward the figure at all (goods, not fees). */
  counted: number
  valued: ReplacementLine[]
  missing: ReplacementLine[]
}

const COUNTED_TYPES = new Set(['VEHICLE', 'EQUIPMENT'])
const LIVE_ASSIGNMENT_STATUSES = new Set(['ASSIGNED', 'CHECKED_OUT'])

function money(v: MoneyLike): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v.toString())
  return Number.isFinite(n) && n > 0 ? n : null
}

function assetValue(a: { currentValue?: MoneyLike; purchasePrice?: MoneyLike }): number | null {
  return money(a.currentValue) ?? money(a.purchasePrice)
}

/** Does this line count toward the figure at all? */
export function countsTowardReplacementValue(li: Pick<ReplacementLineInput, 'type'>): boolean {
  return !!li.type && COUNTED_TYPES.has(li.type)
}

/** The AssetCategory a vehicle line holds against — how it finds its units. */
function holdCategoryId(li: ReplacementLineInput): string | null {
  return li.assetCategoryId ?? li.inventoryItem?.legacyAssetCategoryId ?? null
}

/**
 * Value one line. The `used` set stops two vehicle lines on the same order
 * from both claiming the same reserved unit's value.
 */
function valueLine(
  li: ReplacementLineInput,
  ctx: ReplacementValueContext,
  used: Set<string>,
): { each: number | null; source: ReplacementSource | null } {
  const category = holdCategoryId(li)

  // 1. The specific unit(s) reserved for this line — ours first, then any
  //    unit on the job's holds in that class. Take up to `quantity`; when the
  //    units differ in value, the dearest one prices the line (any of them
  //    could be the one that goes out).
  if (li.type === 'VEHICLE' && category) {
    const candidates = (ctx.assignments ?? [])
      .filter((a) => !a.status || LIVE_ASSIGNMENT_STATUSES.has(a.status))
      .filter((a) => a.asset.categoryId === category && !used.has(a.asset.id))
      .filter((a) => assetValue(a.asset) !== null)
      .sort((a, b) => {
        const mine = (x: ReplacementAssignmentInput) => (li.orderId && x.orderId === li.orderId ? 0 : 1)
        return mine(a) - mine(b) || (assetValue(b.asset) ?? 0) - (assetValue(a.asset) ?? 0)
      })
      .slice(0, Math.max(1, li.quantity))
    if (candidates.length > 0) {
      for (const c of candidates) used.add(c.asset.id)
      const each = Math.max(...candidates.map((c) => assetValue(c.asset) ?? 0))
      return { each, source: 'unit' }
    }
  }

  // 2. The catalog row the line was picked from.
  const catalog = money(li.inventoryItem?.replacementCost)
  if (catalog !== null) return { each: catalog, source: 'catalog' }

  // 3. RentalWorks' per-unit register for that row.
  const register = money(li.inventoryItem?.registerCost)
  if (register !== null) return { each: register, source: 'register' }

  // 4. A vehicle class with no unit bound yet: the dearest active unit in it.
  if (li.type === 'VEHICLE' && category) {
    const fleet = (ctx.fleetAssets ?? [])
      .filter((a) => a.categoryId === category)
      .map(assetValue)
      .filter((v): v is number => v !== null)
    if (fleet.length > 0) return { each: Math.max(...fleet), source: 'fleet' }
  }

  return { each: null, source: null }
}

/** Pure. Feed it lines from one order or from every live order on a job. */
export function deriveReplacementValue(
  lines: ReadonlyArray<ReplacementLineInput>,
  ctx: ReplacementValueContext = {},
): ReplacementValueSummary {
  const valued: ReplacementLine[] = []
  const missing: ReplacementLine[] = []
  const used = new Set<string>()

  for (const li of lines) {
    if (!countsTowardReplacementValue(li)) continue
    const quantity = Math.max(1, li.quantity || 1)
    const { each, source } = valueLine(li, ctx, used)
    const row: ReplacementLine = {
      lineId: li.id,
      orderId: li.orderId ?? null,
      type: li.type ?? 'EQUIPMENT',
      description: li.description,
      quantity,
      each,
      total: each === null ? null : Math.round(each * quantity * 100) / 100,
      source,
      inventoryItemId: li.inventoryItem?.id ?? null,
      partner: (li.subRentals?.length ?? 0) > 0,
    }
    if (each === null) missing.push(row)
    else valued.push(row)
  }

  const total = Math.round(valued.reduce((s, r) => s + (r.total ?? 0), 0) * 100) / 100
  return {
    total,
    complete: missing.length === 0,
    counted: valued.length + missing.length,
    valued,
    missing,
  }
}

// ── Client-facing shape ──────────────────────────────────────────────────────

/** What a production coordinator (and their broker) sees. Descriptions and
 *  quantities only — no catalog ids, no sources, no partner flags. */
export interface ClientReplacementValue {
  total: number
  complete: boolean
  /** Counted lines that still have no value — the reason `total` is a floor. */
  pendingCount: number
  schedule: Array<{ description: string; quantity: number; total: number | null }>
}

export function toClientReplacementValue(s: ReplacementValueSummary): ClientReplacementValue | null {
  if (s.counted === 0) return null
  return {
    total: s.total,
    complete: s.complete,
    pendingCount: s.missing.length,
    schedule: [...s.valued, ...s.missing].map((r) => ({
      description: r.description,
      quantity: r.quantity,
      total: r.total,
    })),
  }
}

export function formatReplacementValue(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

/**
 * The sentence every client surface uses. Kept in one place so the portal,
 * the broker email and the quote never disagree about whether the number is
 * final.
 */
export function replacementValueSentence(v: ClientReplacementValue | null): string | null {
  if (!v) return null
  if (v.complete) return `Replacement value of the rented equipment on this order: ${formatReplacementValue(v.total)}.`
  const n = v.pendingCount
  if (v.total > 0) {
    return (
      `Replacement value of the rented equipment on this order: at least ${formatReplacementValue(v.total)} — ` +
      `${n} item${n === 1 ? '' : 's'} still being valued; the final figure follows from your rep.`
    )
  }
  return 'Replacement value of the rented equipment on this order: being confirmed — your rep will send the figure.'
}

// ── Loaders ─────────────────────────────────────────────────────────────────

/** The line select every loader uses. `registerCost` is filled in separately. */
export const REPLACEMENT_LINE_SELECT = {
  id: true,
  orderId: true,
  type: true,
  description: true,
  quantity: true,
  parentLineItemId: true,
  assetCategoryId: true,
  inventoryItem: { select: { id: true, replacementCost: true, legacyAssetCategoryId: true } },
  subRentals: { select: { id: true } },
} as const

/** Orders whose gear is (or will be) in the client's hands. */
export const LIVE_ORDER_STATUSES = [
  'DRAFT',
  'QUOTE_SENT',
  'APPROVED',
  'BOOKED',
  'LOADED_READY',
  'ON_JOB',
  'RETURNED',
  'LD_CHECK',
  'INVOICED',
] as const

type LoadedLine = {
  id: string
  orderId: string
  type: string
  description: string
  quantity: number
  parentLineItemId: string | null
  assetCategoryId: string | null
  inventoryItem: { id: string; replacementCost: MoneyLike; legacyAssetCategoryId: string | null } | null
  subRentals: { id: string }[]
}

/**
 * RentalWorks' per-unit register: the highest replacementCost among a row's
 * live units. Only asked for rows the catalog could not price — a kit of 400
 * batteries would otherwise ride along on every order read.
 */
async function registerCosts(inventoryItemIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (inventoryItemIds.length === 0) return out
  const rows = await prisma.inventoryUnit.groupBy({
    by: ['inventoryItemId'],
    where: { inventoryItemId: { in: inventoryItemIds }, inactive: false, replacementCost: { gt: 0 } },
    _max: { replacementCost: true },
  })
  for (const r of rows) {
    const v = money(r._max.replacementCost)
    if (r.inventoryItemId && v !== null) out.set(r.inventoryItemId, v)
  }
  return out
}

async function attachRegisterCosts(lines: LoadedLine[]): Promise<ReplacementLineInput[]> {
  const unpriced = Array.from(
    new Set(
      lines
        .filter((l) => l.inventoryItem && money(l.inventoryItem.replacementCost) === null)
        .map((l) => l.inventoryItem!.id),
    ),
  )
  const register = await registerCosts(unpriced)
  return lines.map((l) => ({
    ...l,
    inventoryItem: l.inventoryItem
      ? { ...l.inventoryItem, registerCost: register.get(l.inventoryItem.id) ?? null }
      : null,
  }))
}

/** The job's reserved units (with their fleet values) and the active fleet
 *  by class, for the two vehicle sources. */
async function jobContext(jobId: string | null, categoryIds: string[]): Promise<ReplacementValueContext> {
  const [assignments, fleetAssets] = await Promise.all([
    jobId
      ? prisma.bookingAssignment.findMany({
          where: {
            status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
            bookingItem: { booking: { jobId, archivedAt: null, status: { notIn: ['CANCELLED', 'ARCHIVED'] } } },
          },
          select: {
            orderId: true,
            status: true,
            asset: { select: { id: true, categoryId: true, currentValue: true, purchasePrice: true } },
          },
        })
      : Promise.resolve([]),
    categoryIds.length > 0
      ? prisma.asset.findMany({
          where: { categoryId: { in: categoryIds }, isActive: true },
          select: { categoryId: true, currentValue: true, purchasePrice: true },
        })
      : Promise.resolve([]),
  ])
  return { assignments, fleetAssets }
}

/** One order. Vehicle lines are valued against the job's reserved units. */
export async function loadOrderReplacementValue(orderId: string): Promise<ReplacementValueSummary> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { jobId: true, lineItems: { select: REPLACEMENT_LINE_SELECT, orderBy: { sortOrder: 'asc' } } },
  })
  if (!order) return deriveReplacementValue([])
  const lines = await attachRegisterCosts(order.lineItems as LoadedLine[])
  const categories = Array.from(
    new Set(lines.map((l) => l.assetCategoryId ?? l.inventoryItem?.legacyAssetCategoryId).filter((c): c is string => !!c)),
  )
  return deriveReplacementValue(lines, await jobContext(order.jobId ?? null, categories))
}

/**
 * Every live order on a job, as one figure — what the broker insures is the
 * production's whole rental, not one order of it. Cancelled and closed
 * orders are not in anyone's hands.
 */
export async function loadJobReplacementValue(jobId: string): Promise<ReplacementValueSummary> {
  const orders = await prisma.order.findMany({
    where: { jobId, status: { in: [...LIVE_ORDER_STATUSES] } },
    select: { id: true, lineItems: { select: REPLACEMENT_LINE_SELECT, orderBy: { sortOrder: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  })
  const lines = await attachRegisterCosts(orders.flatMap((o) => o.lineItems as LoadedLine[]))
  const categories = Array.from(
    new Set(lines.map((l) => l.assetCategoryId ?? l.inventoryItem?.legacyAssetCategoryId).filter((c): c is string => !!c)),
  )
  return deriveReplacementValue(lines, await jobContext(jobId, categories))
}
