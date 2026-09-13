/**
 * Client-safe half of the public search contract.
 *
 * Kept SEPARATE from publicSearch.ts on purpose: that module imports the
 * Prisma singleton, and a client component importing it would drag Prisma
 * into the browser bundle (a hard build failure). The typeahead only ever
 * needs these shapes, so they live here and publicSearch.ts re-exports them.
 */

export type PublicSearchKind = 'supply' | 'vehicle' | 'stage' | 'standing-set' | 'page'

/**
 * Everything needed to build a cart line from a search hit WITHOUT a
 * second round trip — the whole point of adding from the search field is
 * that it costs one click, so the payload rides along with the result.
 *
 * Mirrors AddToCartArgs' display half (useSupplyCart.CartLineDisplayInfo)
 * on purpose: the "+" hands this straight to addToCart. Prices here are
 * DISPLAY ONLY — /api/public/supply-request re-snapshots name, price and
 * type from the source tables at submit time, so a stale index can never
 * quote a price we don't honour.
 */
export interface PublicSearchAdd {
  /** Discriminator the submit endpoint resolves the id against. */
  itemKind: 'SUPPLY' | 'VEHICLE'
  /** InventoryItem.id (SUPPLY) or VehicleCategory.id (VEHICLE). */
  itemId: string
  name: string
  /** Daily/unit rate. 0 = price-on-quote (vehicles without a rate). */
  price: number
  /** LineItemType for supplies; 'VEHICLE' for vehicle categories. */
  type: string
  /** Cart grouping label. */
  category: string
}

/** What the typeahead renders. Public-safe fields only — no rates. */
export interface PublicSearchHit {
  id: string
  kind: PublicSearchKind
  /** Display name. */
  label: string
  /** Category / type line under the name. */
  sublabel: string | null
  /** Where a click goes. */
  href: string
  /** Public image-proxy path, or null. */
  image: string | null
  /**
   * What a click DOES. 'order' = it's on the order form, the next click is
   * Add. 'ask' = we rent it but it isn't self-serve, so the click opens a
   * request prefilled with the item.
   *
   * Search covers the whole rentable catalog, not just the self-serve
   * subset — a client searching "walkie" must find the walkie even when
   * nobody has published it to the form yet. This field is what keeps that
   * honest: it never implies you can add something you can't.
   */
  action: 'order' | 'ask'
  /**
   * Non-null = this row carries a "+" that drops it straight into the
   * cart. SEPARATE from `action`, which describes the row CLICK: an owned
   * vehicle is addable but its click still goes to its own page, because
   * the photos and specs are the reason a client clicks a truck.
   *
   * null for anything we can't put on a self-serve line — unpublished
   * gear, no-charge inclusions, stages, standing sets, static pages, and
   * partner-supplied units (the submit endpoint resolves VEHICLE ids
   * against VehicleCategory only, so a SubcontractedVehicle id would be
   * rejected after the client had filled in the whole details form).
   */
  add: PublicSearchAdd | null
}

/** Human label for the kind chip on each result row. */
export const KIND_LABEL: Record<PublicSearchKind, string> = {
  supply: 'Equipment',
  vehicle: 'Vehicle',
  stage: 'Stage',
  'standing-set': 'Standing Set',
  page: 'Page',
}
