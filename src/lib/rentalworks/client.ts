/**
 * RentalWorks API client (read-only).
 *
 * Auth: Bearer JWT in env var RENTALWORKS_TOKEN.
 * Base URL: https://sirreel.rentalworks.cloud
 *
 * Two response shapes coexist in this API:
 *   - "browse"-style POST: /api/v1/<entity>/browse with body
 *     { pageNo, pageSize, searchFields? }; response is tabular
 *     ({ ColumnIndex, Columns, Rows, TotalRows, ... }).
 *   - GET /api/v1/<entity>: response is { Items: [...], TotalItems,
 *     PageNo, PageSize }. Used by /api/v1/item.
 */

const BASE_URL = 'https://sirreel.rentalworks.cloud'

function token(): string {
  const t = process.env.RENTALWORKS_TOKEN
  if (!t) throw new Error('RENTALWORKS_TOKEN env var not set')
  return t
}

interface ItemsResponse<T> {
  Items: T[]
  TotalItems: number
  PageNo: number
  PageSize: number
}

/**
 * RentalWorks Item — physical-asset row from /api/v1/item. The catalog
 * master is referenced via InventoryId; multiple Items share the same
 * InventoryId (one Item per physical / barcoded unit).
 *
 * Field set is intentionally narrow — only what the catalog import uses.
 * The full row has ~200 fields (per /api/v1/item sample).
 */
export interface RwItem {
  ItemId: string
  InventoryId: string
  ICode: string
  Description: string
  ItemDescription: string
  Manufacturer: string
  ManufacturerPartNumber: string
  ManufacturerModelNumber: string
  CategoryId: string
  Category: string
  SubCategoryId: string
  SubCategory: string
  InventoryType: string
  InventoryTypeId: string
  Inactive: boolean
  Status: string
  InventoryStatus: string
  WidthFt: number
  WidthIn: number
  HeightFt: number
  HeightIn: number
  LengthFt: number
  LengthIn: number
  UnitValue: number
  ReplacementCost: number
  DailyRate: number
  WeeklyRate: number
  MonthlyRate: number
  ItemNotes: string
  Warehouse: string
  WarehouseId: string
  Classification: string
  Rank: string
}

export async function rwGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    throw new Error(`RW GET ${path} → ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

/**
 * Fetch every Item from /api/v1/item, paginated. Default pageSize 200
 * which gives ~9 round trips for the current 1797-row catalog.
 *
 * Pass `onPage` to get progress events (useful for the import script).
 */
export async function fetchAllItems(opts?: {
  pageSize?: number
  onPage?: (page: number, totalPages: number, fetched: number, total: number) => void
}): Promise<RwItem[]> {
  const pageSize = opts?.pageSize ?? 200
  const all: RwItem[] = []
  let page = 1
  while (true) {
    const data = await rwGet<ItemsResponse<RwItem>>(`/api/v1/item?pageNo=${page}&pageSize=${pageSize}`)
    all.push(...data.Items)
    const totalPages = Math.max(1, Math.ceil(data.TotalItems / pageSize))
    opts?.onPage?.(page, totalPages, all.length, data.TotalItems)
    if (page >= totalPages || data.Items.length === 0) break
    page += 1
  }
  return all
}

/**
 * RW catalog master, synthesized by grouping RwItem[] by InventoryId.
 * One row per unique master product; the import compares these against
 * SirReel's InventoryItem table.
 */
export interface RwMaster {
  rwInventoryId: string
  iCode: string
  description: string
  manufacturer: string | null
  model: string | null
  categoryRwId: string | null
  category: string | null
  subCategory: string | null
  inventoryType: string | null
  dimensions: string | null
  unitValue: number
  replacementCost: number
  dailyRate: number
  weeklyRate: number
  monthlyRate: number
  qtyActive: number    // count of Items with Inactive=false
  qtyTotal: number     // count of all Items in the group
  notes: string | null
}

function fmtDimension(ft: number, inches: number): string | null {
  const fNum = Number(ft) || 0
  const iNum = Number(inches) || 0
  if (fNum === 0 && iNum === 0) return null
  if (fNum === 0) return `${iNum}"`
  if (iNum === 0) return `${fNum}'`
  return `${fNum}'${iNum}"`
}

function joinDimensions(w: string | null, h: string | null, l: string | null): string | null {
  const parts = [w, h, l].filter((x) => x !== null) as string[]
  if (parts.length === 0) return null
  return parts.join(' × ')
}

/**
 * Most common non-empty value across a list, breaking ties by first-seen.
 */
function modeOrFirst<T>(values: T[], isEmpty: (v: T) => boolean): T | null {
  const counts = new Map<T, number>()
  let firstNonEmpty: T | null = null
  for (const v of values) {
    if (isEmpty(v)) continue
    if (firstNonEmpty === null) firstNonEmpty = v
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  let best: T | null = firstNonEmpty
  let bestCount = 0
  for (const [v, c] of counts.entries()) {
    if (c > bestCount) { best = v; bestCount = c }
  }
  return best
}

const isEmptyStr = (s: string) => !s || s.trim() === ''

/**
 * Group a flat RwItem[] into one RwMaster per InventoryId.
 *
 * Aggregation rules (matches Step-2 mapping in the brief):
 *   - description: most common non-empty `Description`
 *   - rates / replacementCost: first non-zero seen across the group
 *   - manufacturer / model / category: most common non-empty
 *   - qtyOwned (computed in import script, not here): count of !Inactive
 *   - skip the master entirely if every Item is Inactive
 */
export function groupItemsToMasters(items: RwItem[]): RwMaster[] {
  const buckets = new Map<string, RwItem[]>()
  for (const it of items) {
    const key = it.InventoryId
    if (!key) continue
    const arr = buckets.get(key) ?? []
    arr.push(it)
    buckets.set(key, arr)
  }

  const masters: RwMaster[] = []
  for (const [invId, group] of buckets.entries()) {
    const active = group.filter((g) => !g.Inactive)
    if (active.length === 0) continue // every unit is retired — skip

    const description = modeOrFirst(group.map((g) => g.Description), isEmptyStr) ?? ''
    const iCode = modeOrFirst(group.map((g) => g.ICode), isEmptyStr) ?? ''
    if (!iCode) continue // can't import without a stable code

    const manufacturer = modeOrFirst(group.map((g) => g.Manufacturer), isEmptyStr)
    const model =
      modeOrFirst(group.map((g) => g.ManufacturerPartNumber), isEmptyStr) ??
      modeOrFirst(group.map((g) => g.ManufacturerModelNumber), isEmptyStr)
    const category = modeOrFirst(group.map((g) => g.Category), isEmptyStr)
    const categoryRwId = modeOrFirst(group.map((g) => g.CategoryId), isEmptyStr)
    const subCategory = modeOrFirst(group.map((g) => g.SubCategory), isEmptyStr)
    const inventoryType = modeOrFirst(group.map((g) => g.InventoryType), isEmptyStr)

    // Use the first non-empty dimension set for the master record. Mixing
    // dimensions across instances rarely makes sense at master level.
    let dimensions: string | null = null
    for (const it of group) {
      const w = fmtDimension(it.WidthFt, it.WidthIn)
      const h = fmtDimension(it.HeightFt, it.HeightIn)
      const l = fmtDimension(it.LengthFt, it.LengthIn)
      const joined = joinDimensions(w, h, l)
      if (joined) { dimensions = joined; break }
    }

    const firstNonZero = (vals: number[]): number => vals.find((v) => v && v > 0) ?? 0
    const dailyRate = firstNonZero(group.map((g) => Number(g.DailyRate) || 0))
    const weeklyRate = firstNonZero(group.map((g) => Number(g.WeeklyRate) || 0))
    const monthlyRate = firstNonZero(group.map((g) => Number(g.MonthlyRate) || 0))
    const replacementCost = firstNonZero(group.map((g) => Number(g.ReplacementCost) || 0))
    const unitValue = firstNonZero(group.map((g) => Number(g.UnitValue) || 0))

    const notes = modeOrFirst(group.map((g) => g.ItemNotes), isEmptyStr)

    masters.push({
      rwInventoryId: invId,
      iCode,
      description,
      manufacturer,
      model,
      categoryRwId,
      category,
      subCategory,
      inventoryType,
      dimensions,
      unitValue,
      replacementCost,
      dailyRate,
      weeklyRate,
      monthlyRate,
      qtyActive: active.length,
      qtyTotal: group.length,
      notes,
    })
  }
  return masters
}
