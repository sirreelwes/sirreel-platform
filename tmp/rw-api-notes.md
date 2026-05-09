# RentalWorks API — Spike Notes

**Base URL:** `https://sirreel.rentalworks.cloud`
**Auth:** Bearer JWT in `Authorization` header. Token in env var `RENTALWORKS_TOKEN`.
**Conventions:** Two response shapes coexist:

- **`browse`-style (POST):** path `/api/v1/<entity>/browse`, body `{ pageNo, pageSize, searchFields?: [{ fieldName, searchValue, searchType }] }`. Response is a tabular shape with `ColumnIndex` (field name → index), `Columns`, `Rows` (array of arrays), `TotalRows`, `PageNo`, `PageSize`, `TotalPages`. Used by most entities including `category`, `department`, `customer`, `vendor`, `invoice`, `payment`, `deal`, `contact`.
- **`/api/v1/<entity>` (GET):** returns `{ Items: [...], PageNo, PageSize, TotalItems, Sort }`. Each Item is a flat object. Used by `item`.

Existing helper code in repo: `src/app/api/rentalworks/route.ts`, `src/app/api/rentalworks/order/route.ts`, `src/app/api/rentalworks/order-items-test/route.ts`. Pattern: `Bearer ${TOKEN}` header, JSON body, browse semantics.

---

## Catalog endpoint — INVENTORY MASTER

**`GET /api/v1/item?pageNo=1&pageSize=N`**

**Total: 1797 physical-asset rows.** This is the only catalog endpoint we found that exposes per-product data. Each row is a single physical instance (BARCODE-tracked). The catalog "master product" is referenced via the `InventoryId` field — multiple Items can share the same InventoryId (multiple physical units of the same product). To get the unique catalog products we'll group by `InventoryId` and aggregate.

**Pagination:** standard `pageNo` / `pageSize` query params. Default page size returns ~10 items. Tested up to `pageSize=2`. Will pull at `pageSize=200` for the import (~9 pages).

**Important fields on each row:**

| Field | Type | Notes |
|---|---|---|
| `ItemId` | string | Unique per physical instance (e.g. `A000LF6E`) |
| `InventoryId` | string | **Master catalog ID** (e.g. `A000LEKT`) — multiple Items share this |
| `ICode` | string | **Catalog code** (e.g. `105141`). Consistent within an InventoryId group. Primary join key candidate. |
| `Description` | string | Catalog name (e.g. `Dewalt - Flexvolt Charger (4 Port)`) |
| `ItemDescription` | string | Per-instance description; usually empty |
| `BarCode` / `SerialNumber` / `RfId` | string | Per-instance |
| `ManufacturerPartNumber` | string | e.g. `DCB104` |
| `ManufacturerModelNumber` | string | Often empty |
| `Manufacturer` / `ManufacturerId` | string | e.g. populated for some items |
| `Category` / `CategoryId` | string | RW category name (e.g. `Lights & Power`, `CategoryId: A00026QK`) |
| `SubCategory` / `SubCategoryId` | string | Often empty |
| `InventoryType` / `InventoryTypeId` | string | e.g. `Production` |
| `WidthFt`, `WidthIn`, `HeightFt`, `HeightIn`, `LengthFt`, `LengthIn` | int | Per-instance dimensions; should be consistent within InventoryId |
| `UnitValue` | decimal | e.g. `229` |
| `ReplacementCost` | decimal | e.g. `297.7` |
| `DailyRate`, `WeeklyRate`, `MonthlyRate` | decimal | Per-item rate; same within InventoryId |
| `Ownership` | string | `OWNED` etc. |
| `Inactive` | bool | Filter out for active catalog |
| `Status` / `InventoryStatus` | string | e.g. `IN` (in stock) |
| `Warehouse` / `WarehouseCode` | string | Single-warehouse setup at SirReel |
| `Classification`, `Rank` | string | `A` / `B` / `C` |
| `ItemNotes` | string | Per-instance notes (rare) |

Total physical items: **1797**. Unique InventoryIds (catalog masters): unknown until we group — will report in pre-flight.

**RW code format ≠ SirReel code format.** SirReel's existing `inventory_items.code` field has values like `Folding Chairs` / `25 LB. SANDBAG` / `Motorola CP200 UHF Radio (Analog)` — these look more like RW *Descriptions* than RW *ICodes*. Expect step B (name-match-with-code-realignment) to dominate.

---

## Other endpoints inventoried (Phase 4 prep)

All return 200 with the `browse` shape (`ColumnIndex/Rows/TotalRows`). Auth = same bearer token.

| Endpoint | TotalRows | Use |
|---|---:|---|
| `POST /api/v1/category/browse` | 102 | Inventory categories. ColumnIndex includes `CategoryId`, `Category`, `RecType`, `RecTypeDescription`, `TypeId`, `Type`, `InventoryType`, `WarehouseCategory`, `HasMaintenance`, `PreventiveMaintenanceCycle`, `DepreciationM…`. Useful for category mapping. |
| `POST /api/v1/rentalcategory/browse` | (same shape, 102) | Filtered to rental categories. Adds `InventoryTypeId`. |
| `POST /api/v1/department/browse` | 11 | Departments. **The names mirror SirReel's LineItemDepartment closely:** Trucking (Vehicle), G&E, Pro Supplies / Comm, Art Dept, Studios, Expendables, Napa Events, Vertical, REPAIR, SALES, Trailers & Mohos. Useful for the catalog department backfill. |
| `POST /api/v1/customer/browse` | (large; not measured) | CRM clients. Phase 4 prep. |
| `POST /api/v1/vendor/browse` | 25 | Sub-rental vendors. |
| `POST /api/v1/warehouse/browse` | 1 | Single warehouse — confirms SirReel is single-location in RW. |
| `POST /api/v1/contact/browse` | 4323 | Person-level contacts. CRM cross-reference for Phase 4. |
| `POST /api/v1/deal/browse` | 1965 | **Deals = jobs/opportunities.** Major Phase 4 source. |
| `POST /api/v1/invoice/browse` | (large) | Invoices. Phase 4 export target. |
| `POST /api/v1/payment/browse` | (large) | Payments. AR / collections data. |
| `GET /api/v1/department/<id>` | — | Single-record GET works for entities with `<entity>` GET routes. Returns the same flat shape as the list. |

**Endpoints that didn't open (not in scope but recorded):**

- `quote/browse` → 500 (server error)
- `bid/browse` → 404
- `availability/browse`, `inventory/availability`, `asset/availability`, `rentalitem/availability`, `order/availability` → all 404 / 405 — RW doesn't expose availability via this API surface as far as we found. Phase 4 dispatch view will need a different approach.
- `inventory/browse`, `inventoryitem/browse`, `product/browse`, `asset/browse`, `rentalitem/browse`, `master/browse`, `itemmaster/browse`, `equipment/browse` → all 404. The catalog master is reached via aggregated `/api/v1/item` GET only.
- `orderitem/browse` and `item/browse` → 500 with `Invalid column name 'rentalitemid'` / `'masteritemid'` — possibly need a different parameter shape; not pursued since `/api/v1/item` GET satisfies our needs.

---

## Auth pattern (verified)

```ts
const BASE_URL = 'https://sirreel.rentalworks.cloud'
const TOKEN = process.env.RENTALWORKS_TOKEN!

await fetch(`${BASE_URL}${path}`, {
  method: 'GET' | 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  },
  body: body ? JSON.stringify(body) : undefined,
})
```

JWT does not appear to expire on a short cycle — existing routes have been calling RW for months without refresh. Token-refresh automation already on the active roadmap (per CLAUDE.md).

---

## Read-only confirmed

The brief says read-only. We did not attempt POST / PUT / DELETE on inventory or other write endpoints. The `browse` and GET endpoints we hit are explicitly read operations.
