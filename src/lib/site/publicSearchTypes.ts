/**
 * Client-safe half of the public search contract.
 *
 * Kept SEPARATE from publicSearch.ts on purpose: that module imports the
 * Prisma singleton, and a client component importing it would drag Prisma
 * into the browser bundle (a hard build failure). The typeahead only ever
 * needs these shapes, so they live here and publicSearch.ts re-exports them.
 */

export type PublicSearchKind = 'supply' | 'vehicle' | 'stage' | 'standing-set' | 'page'

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
}

/** Human label for the kind chip on each result row. */
export const KIND_LABEL: Record<PublicSearchKind, string> = {
  supply: 'Equipment',
  vehicle: 'Vehicle',
  stage: 'Stage',
  'standing-set': 'Standing Set',
  page: 'Page',
}
