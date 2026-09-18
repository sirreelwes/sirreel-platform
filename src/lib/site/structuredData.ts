import { PUBLIC_SITE_ORIGIN, publicUrl } from '@/lib/site/publicUrl'

/**
 * JSON-LD builders for the public marketing site.
 *
 * Pure — no prisma, no React, no `headers()`. Every builder takes the same
 * plain values the page renders and returns a schema.org object (or null
 * when there is nothing honest to say). That is the whole discipline here:
 * markup that claims something the visitor cannot see is what gets a site
 * flagged as spam, so a builder never invents a field, and a missing fact
 * drops the property rather than guessing at it.
 *
 * WHAT THIS IS AND IS NOT FOR. Structured data was designed for search
 * rich results, not for LLMs — the answer engines that fetch a page read
 * the rendered text, not the <script> tag. Its value is at the RETRIEVAL
 * layer: Bing consumes schema.org and grounds ChatGPT/Copilot, and
 * rich-result eligibility feeds Google's AI Overviews. Treat it as making
 * the catalog machine-legible, not as a ranking lever. The prose on the
 * page is still what gets quoted back.
 *
 * ONE BUSINESS ENTITY. PublicSiteJsonLd (Home) owns the LocalBusiness node
 * at `#business`; everything here REFERENCES it by @id rather than
 * restating it. Two business nodes at one address is how a knowledge panel
 * gets confused, so stages and standing sets are modelled as rental
 * PRODUCTS of that one business, not as Places of their own.
 */

/** @id of the LocalBusiness node PublicSiteJsonLd renders on Home. */
export const BUSINESS_ID = `${PUBLIC_SITE_ORIGIN}/#business`

/**
 * GoodRelations business function for a rental.
 *
 * Without it a `Product` + `Offer` reads as a $175 van FOR SALE. This one
 * URI is what says "per day, leased, comes back" to a machine, and it is
 * the single most consequential property in this file for a rental house.
 */
const LEASE_OUT = 'http://purl.org/goodrelations/v1#LeaseOut'

export interface JsonLdNode {
  '@type': string
  [key: string]: unknown
}

/** A crumb in a breadcrumb trail. `path` is site-relative. */
export interface Crumb {
  name: string
  path: string
}

/** One entry on a listing page. `path` is site-relative. */
export interface ListEntry {
  name: string
  path: string
}

/** Spec rows become PropertyValue pairs; blank values are dropped. */
export interface SpecPair {
  label: string
  value: string | null | undefined
}

/**
 * Absolute URL for a site-relative path. Schema.org values must resolve
 * from anywhere (an inbox, another origin, a crawler with no base), so
 * every url/image in this file goes through here.
 */
function abs(path: string): string {
  return path.startsWith('http') ? path : publicUrl(path)
}

/** Drop empty/blank entries and map to PropertyValue. */
function propertyValues(specs: SpecPair[]): JsonLdNode[] {
  return specs
    .filter((s) => typeof s.value === 'string' && s.value.trim() !== '')
    .map((s) => ({ '@type': 'PropertyValue', name: s.label, value: (s.value as string).trim() }))
}

/**
 * The rental offer for one catalog row.
 *
 * Returns null when there is no public price. A price-on-quote unit gets
 * NO offers block at all rather than an Offer with a missing or zero
 * price: an offer without a price is not eligible for a rich result
 * anyway, and a `0` would publish "free" to every machine that reads it.
 * The page already says PRICE ON QUOTE; the markup simply stays quiet.
 */
export function rentalOffer(dailyRate: number | null | undefined, path: string): JsonLdNode | null {
  if (dailyRate == null || dailyRate <= 0) return null
  const url = abs(path)
  return {
    '@type': 'Offer',
    url,
    availability: 'https://schema.org/InStock',
    businessFunction: LEASE_OUT,
    priceCurrency: 'USD',
    price: dailyRate,
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      priceCurrency: 'USD',
      price: dailyRate,
      // "per 1 DAY" — the /day the page prints beside the number.
      referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'DAY' },
    },
    seller: { '@id': BUSINESS_ID },
  }
}

export interface RentalProductInput {
  name: string
  path: string
  description?: string | null
  /** Site-relative or absolute image paths, primary first. */
  images?: (string | null | undefined)[]
  /** Section/heading this row sits under, e.g. "Specialty Vehicles". */
  category?: string | null
  dailyRate?: number | null
  specs?: SpecPair[]
}

/**
 * A rentable catalog row — a vehicle, a stage, a standing set.
 *
 * All three are the same shape to a machine: a named thing, at one
 * business, that you lease by the day. Modelling the stages as `Place`
 * instead would have created rival venue entities at 8500 Lankershim,
 * which is the opposite of what the LocalBusiness node is doing.
 */
export function rentalProductJsonLd(input: RentalProductInput): JsonLdNode {
  const url = abs(input.path)
  const images = (input.images ?? []).filter((s): s is string => !!s && s.trim() !== '').map(abs)
  const offer = rentalOffer(input.dailyRate, input.path)
  const properties = propertyValues(input.specs ?? [])

  const node: JsonLdNode = {
    '@type': 'Product',
    '@id': `${url}#product`,
    name: input.name,
    url,
  }
  if (input.description && input.description.trim() !== '') {
    node.description = input.description.trim()
  }
  if (images.length) node.image = images
  if (input.category && input.category.trim() !== '') node.category = input.category.trim()
  if (properties.length) node.additionalProperty = properties
  if (offer) node.offers = offer
  return node
}

/**
 * BreadcrumbList for a detail page.
 *
 * This is what renders the path line under a search result instead of a
 * raw URL, and it tells a crawler that /vehicles/cube-27 belongs to
 * /vehicles rather than floating loose.
 */
export function breadcrumbJsonLd(trail: Crumb[]): JsonLdNode | null {
  if (trail.length === 0) return null
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: abs(c.path),
    })),
  }
}

/**
 * ItemList for a listing page.
 *
 * Says "this page is a catalog of those pages" rather than leaving a
 * crawler to infer it from a wall of cards. Summary-page form (url only) —
 * the detail page carries the Product node, so restating it here would be
 * two sources of truth for one van.
 */
export function itemListJsonLd(entries: ListEntry[], listName?: string): JsonLdNode | null {
  if (entries.length === 0) return null
  const node: JsonLdNode = {
    '@type': 'ItemList',
    numberOfItems: entries.length,
    itemListElement: entries.map((e, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: e.name,
      url: abs(e.path),
    })),
  }
  if (listName) node.name = listName
  return node
}

/**
 * Wrap nodes into one `@graph` document.
 *
 * One <script> per page rather than three: nodes in a graph can reference
 * each other by @id (the offers all point at `#business`), and a single
 * block is one thing to validate. Nulls are dropped, so a page with
 * nothing to say renders no tag at all.
 */
export function jsonLdGraph(nodes: (JsonLdNode | null | undefined)[]): Record<string, unknown> | null {
  const present = nodes.filter((n): n is JsonLdNode => !!n)
  if (present.length === 0) return null
  return { '@context': 'https://schema.org', '@graph': present }
}
