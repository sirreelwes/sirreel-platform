/**
 * Single source of truth for rate resolution (audit §4: the same
 * `assetCategory?.dailyRate ?? vehicleCategory.dailyRate` fallback was
 * re-implemented inline in three files, and line-item rates were a
 * client-supplied snapshot the server never checked).
 *
 * Resolution policy:
 *   - AssetCategory.dailyRate/weeklyRate (Fleet Pricing) is canonical.
 *   - VehicleCategory.dailyRate is a fallback ONLY when the linked
 *     AssetCategory rate is null (or there is no link).
 *   - InventoryItem.dailyRate/weeklyRate for warehouse/catalog items.
 *
 * All math stays in Prisma.Decimal rounded to cents — callers convert to
 * Number only at the display/serialization boundary.
 */

import { Prisma } from '@prisma/client'
import type { RateType } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** Works with the singleton client or a transaction client. */
export type Db = Prisma.TransactionClient

const roundCents = (d: Prisma.Decimal) =>
  d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)

/**
 * Parse client-supplied money (string or number) into a cent-rounded
 * Decimal. Returns null when unparseable — callers decide whether that
 * is a 400 or a fallback. NEVER feed parseFloat/Number output into a
 * Decimal column write; route raw input through here instead.
 */
export function parseMoney(v: unknown): Prisma.Decimal | null {
  if (v === null || v === undefined || v === '') return null
  try {
    const d = new Prisma.Decimal(typeof v === 'string' ? v.trim() : (v as number))
    if (!d.isFinite()) return null
    return roundCents(d)
  } catch {
    return null
  }
}

export interface RateResolutionInput {
  inventoryItemId?: string | null
  assetCategoryId?: string | null
  vehicleCategoryId?: string | null
}

export interface ResolvedRates {
  dailyRate: Prisma.Decimal | null
  weeklyRate: Prisma.Decimal | null
  source: 'INVENTORY_ITEM' | 'ASSET_CATEGORY' | 'VEHICLE_CATEGORY' | 'NONE'
}

/**
 * The one resolver. Rates ≤ 0 are treated as "not configured" (matches
 * the public catalog's `price === 0 && !includedFree → hide` rule) and
 * come back null so a typed-in rate on an unpriced item never reads as
 * an "override of $0".
 */
export async function resolveRate(
  input: RateResolutionInput,
  db: Db = prisma,
): Promise<ResolvedRates> {
  const positive = (d: Prisma.Decimal | null | undefined): Prisma.Decimal | null =>
    d != null && d.greaterThan(0) ? roundCents(d) : null

  if (input.inventoryItemId) {
    const item = await db.inventoryItem.findUnique({
      where: { id: input.inventoryItemId },
      select: { dailyRate: true, weeklyRate: true },
    })
    if (!item) return { dailyRate: null, weeklyRate: null, source: 'NONE' }
    return {
      dailyRate: positive(item.dailyRate),
      weeklyRate: positive(item.weeklyRate),
      source: 'INVENTORY_ITEM',
    }
  }

  if (input.assetCategoryId) {
    const ac = await db.assetCategory.findUnique({
      where: { id: input.assetCategoryId },
      select: { dailyRate: true, weeklyRate: true },
    })
    const daily = positive(ac?.dailyRate)
    const weekly = positive(ac?.weeklyRate)
    if (daily || weekly) return { dailyRate: daily, weeklyRate: weekly, source: 'ASSET_CATEGORY' }
    // fall through to vehicleCategory fallback below (if provided)
  }

  if (input.vehicleCategoryId) {
    const vc = await db.vehicleCategory.findUnique({
      where: { id: input.vehicleCategoryId },
      select: {
        dailyRate: true,
        assetCategory: { select: { dailyRate: true, weeklyRate: true } },
      },
    })
    if (!vc) return { dailyRate: null, weeklyRate: null, source: 'NONE' }
    const acDaily = positive(vc.assetCategory?.dailyRate)
    if (acDaily) {
      return {
        dailyRate: acDaily,
        weeklyRate: positive(vc.assetCategory?.weeklyRate),
        source: 'ASSET_CATEGORY',
      }
    }
    const own = positive(vc.dailyRate)
    return { dailyRate: own, weeklyRate: null, source: own ? 'VEHICLE_CATEGORY' : 'NONE' }
  }

  return { dailyRate: null, weeklyRate: null, source: 'NONE' }
}

/**
 * Pure per-row form of the same policy for LIST endpoints that already
 * joined `assetCategory` (public vehicle pages, order form, admin spec
 * editor) — avoids an N+1 against resolveRate while keeping the fallback
 * rule in one file. Generic so it works with the loosely-typed rows those
 * routes select.
 */
export function pickEffectiveDailyRate<T>(row: {
  dailyRate: T | null
  assetCategory?: { dailyRate: T | null } | null
}): T | null {
  return row.assetCategory?.dailyRate ?? row.dailyRate
}

export interface LineRateResult {
  /** What the line will bill at (client override or the resolved rate). */
  rate: Prisma.Decimal
  /** Fleet-Pricing/catalog truth at write time; null when nothing to resolve. */
  resolvedRate: Prisma.Decimal | null
  /** True when the client-requested rate differs from a non-null resolved rate. */
  rateOverridden: boolean
}

/**
 * Server-side line-item rate resolution. The client-sent `rate` is an
 * OVERRIDE REQUEST, not truth: when it differs from the resolved catalog
 * rate the line stores both and flips `rateOverridden` (caller logs the
 * override). $0 package members / includedFree items are NOT overrides.
 *
 * Returns null when clientRate is unparseable — caller should 400.
 */
export async function resolveLineRate(
  input: {
    inventoryItemId?: string | null
    assetCategoryId?: string | null
    rateType: RateType
    clientRate: unknown
    /** package-member lines legitimately carry rate=0 */
    isPackageMember?: boolean
  },
  db: Db = prisma,
): Promise<LineRateResult | null> {
  const clientDec = parseMoney(input.clientRate)
  if (clientDec === null) return null

  const resolved = await resolveRate(
    { inventoryItemId: input.inventoryItemId, assetCategoryId: input.assetCategoryId },
    db,
  )
  const catalogRate =
    input.rateType === 'DAILY' ? resolved.dailyRate :
    input.rateType === 'WEEKLY' ? resolved.weeklyRate :
    null // MONTHLY/FLAT have no catalog source today

  if (catalogRate === null) {
    return { rate: clientDec, resolvedRate: null, rateOverridden: false }
  }
  if (clientDec.equals(catalogRate)) {
    return { rate: catalogRate, resolvedRate: catalogRate, rateOverridden: false }
  }
  if (clientDec.isZero() && input.isPackageMember) {
    // includedFree-style $0 line inside a package — priced by the header.
    return { rate: clientDec, resolvedRate: catalogRate, rateOverridden: false }
  }
  if (clientDec.isZero() && input.inventoryItemId) {
    const item = await db.inventoryItem.findUnique({
      where: { id: input.inventoryItemId },
      select: { includedFree: true },
    })
    if (item?.includedFree) {
      return { rate: clientDec, resolvedRate: catalogRate, rateOverridden: false }
    }
  }
  return { rate: clientDec, resolvedRate: catalogRate, rateOverridden: true }
}

export interface FeeLineResult extends LineRateResult {
  fee: {
    id: string
    name: string
    code: string
    unit: 'FLAT' | 'PER_DAY' | 'PER_MILE' | 'PER_GALLON' | 'PERCENT'
    description: string | null
  }
}

/**
 * Server-side fee pricing — the FeeItem analogue of resolveLineRate,
 * same trust model: the client sends the fee id (+ percentBase for
 * PERCENT fees); the SERVER derives the rate from FeeItem.amount. A
 * client-sent rate that differs is an override request → stored with
 * rateOverridden and audit-logged by the caller.
 *
 * Unit → per-line rate:
 *   FLAT / PER_DAY / PER_MILE / PER_GALLON — rate IS FeeItem.amount;
 *     the multiplier (count, days, miles, gallons) is the line's
 *     quantity/billableDays, so computeLineTotal stays the only math.
 *   PERCENT — rate is amount% × percentBase, computed here and billed
 *     as a one-shot (qty=1 × 1 day) line.
 *
 * Returns null when the fee is missing/inactive, PERCENT is missing a
 * positive base, or clientRate is unparseable — caller 400s.
 */
export async function resolveFeeLineRate(
  input: {
    feeItemId: string
    /** Absent/undefined = "use the catalog amount" (no override). */
    clientRate?: unknown
    /** Dollar base for PERCENT fees; ignored for other units. */
    percentBase?: unknown
  },
  db: Db = prisma,
): Promise<FeeLineResult | null> {
  const fee = await db.feeItem.findUnique({
    where: { id: input.feeItemId },
    select: { id: true, name: true, code: true, amount: true, unit: true, description: true, isActive: true },
  })
  if (!fee || !fee.isActive) return null

  let resolved: Prisma.Decimal
  if (fee.unit === 'PERCENT') {
    const base = parseMoney(input.percentBase)
    if (base === null || !base.greaterThan(0)) return null
    resolved = roundCents(base.mul(fee.amount).div(100))
  } else {
    resolved = roundCents(fee.amount)
  }

  const feeShape = {
    id: fee.id, name: fee.name, code: fee.code,
    unit: fee.unit, description: fee.description,
  }
  if (input.clientRate === undefined || input.clientRate === null || input.clientRate === '') {
    return { rate: resolved, resolvedRate: resolved, rateOverridden: false, fee: feeShape }
  }
  const clientDec = parseMoney(input.clientRate)
  if (clientDec === null) return null
  if (clientDec.equals(resolved)) {
    return { rate: resolved, resolvedRate: resolved, rateOverridden: false, fee: feeShape }
  }
  return { rate: clientDec, resolvedRate: resolved, rateOverridden: true, fee: feeShape }
}

/**
 * Quote-time snapshot (Sprint 1 STEP 3): on the DRAFT → QUOTE_SENT
 * transition, persist resolvedRate on every line that still lacks one so
 * later Fleet Pricing edits can never rewrite what the client was quoted.
 * Only fills nulls — never touches `rate`, `rateOverridden`, or an
 * existing snapshot. Returns how many lines were stamped.
 */
export async function snapshotResolvedRates(orderId: string, db: Db = prisma): Promise<number> {
  const lines = await db.orderLineItem.findMany({
    where: {
      orderId,
      resolvedRate: null,
      OR: [{ inventoryItemId: { not: null } }, { assetCategoryId: { not: null } }],
    },
    select: { id: true, inventoryItemId: true, assetCategoryId: true, rateType: true },
  })
  let stamped = 0
  for (const line of lines) {
    const resolved = await resolveRate(
      { inventoryItemId: line.inventoryItemId, assetCategoryId: line.assetCategoryId },
      db,
    )
    const rate =
      line.rateType === 'DAILY' ? resolved.dailyRate :
      line.rateType === 'WEEKLY' ? resolved.weeklyRate :
      null
    if (rate) {
      await db.orderLineItem.update({ where: { id: line.id }, data: { resolvedRate: rate } })
      stamped++
    }
  }
  return stamped
}

/**
 * Audit trail for a staff rate override. Lands in AuditLog (NOT
 * RateChangeLog — that table is catalog-scoped: no orderId column,
 * non-nullable weekly columns, no override source value; extending it
 * was out of scope for the Sprint-1 no-schema-change rule).
 */
export async function logRateOverride(
  db: Db,
  args: {
    orderId: string
    orderLineItemId: string
    resolvedRate: Prisma.Decimal
    overrideRate: Prisma.Decimal
    rateType: RateType
    userId: string | null
    ipAddress?: string | null
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: args.userId,
      ipAddress: args.ipAddress ?? null,
      action: 'order.line_item_rate_override',
      entityType: 'OrderLineItem',
      entityId: args.orderLineItemId,
      oldValues: { resolvedRate: args.resolvedRate.toFixed(2), rateType: args.rateType },
      newValues: { overrideRate: args.overrideRate.toFixed(2), orderId: args.orderId },
    },
  })
}
