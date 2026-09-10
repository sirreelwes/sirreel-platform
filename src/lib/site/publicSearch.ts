/**
 * Site-wide public search index (2026-09-09).
 *
 * ONE searchable index over everything a client can reach on the public
 * site — supplies/equipment, vehicles, stages, standing sets, and the
 * handful of static pages. Built for the Home hero search field, but the
 * index is surface-agnostic so the header/order form can share it.
 *
 * WHY AN INDEX AND NOT A QUERY PER KEYSTROKE: the catalog only grows
 * (that's the point — more gear, still findable in a keystroke). A
 * per-keystroke `findMany` with substring filters gets slower with every
 * item added, and Postgres can't substring-match inside a String[] anyway
 * (`has` is exact-element only — same constraint /api/public/catalog hit).
 * So the whole public surface is loaded ONCE, cached in-process for
 * INDEX_TTL_MS, and matched in memory. Typeahead cost stays flat as the
 * catalog grows; the DB sees at most one read a minute per lambda.
 *
 * VISIBILITY is never re-implemented here — it reuses the same gates as
 * the public pages (PUBLIC_VEHICLE_VISIBLE_WHERE, PUBLIC_SPACE_VISIBLE_WHERE,
 * and the catalog's publicVisible + active + categorized + priced rule), so
 * an unpublished vehicle or an un-priced item can never leak through search
 * when it's hidden everywhere else.
 */

import { prisma } from '@/lib/prisma'
import { getPublicVehicles } from '@/lib/site/vehicleCatalog'
import { PUBLIC_SPACE_VISIBLE_WHERE } from '@/lib/site/spaces'
import { haystack as buildHaystack, matchesQuery, placement, queryVariants } from '@/lib/site/publicTextMatch'
import { PUBLISHABLE_CANDIDATE_WHERE, hasPublicPrice } from '@/lib/catalog/publicVisibility'
import { contactPrefillHref } from '@/lib/site/publicNav'
import type { PublicSearchHit, PublicSearchKind } from '@/lib/site/publicSearchTypes'

export type { PublicSearchKind, PublicSearchHit } from '@/lib/site/publicSearchTypes'
export { KIND_LABEL } from '@/lib/site/publicSearchTypes'

interface IndexEntry extends PublicSearchHit {
  /** Lowercased name + category + aliases + code, matched as a substring. */
  haystack: string
  /** Rank input only — never returned to the client. */
  inStock: boolean
}

/**
 * Static pages worth finding by name. Deliberately hand-kept and short —
 * this is a wayfinding aid, not a document index. Keep in sync with the
 * (public) route group when a page is added.
 */
const STATIC_PAGES: Array<{ label: string; href: string; keywords: string }> = [
  { label: 'Vehicles', href: '/vehicles', keywords: 'fleet trucks vans cube camera cargo passenger production vehicles' },
  { label: 'Production Supplies & Equipment', href: '/order/supplies', keywords: 'order form catalog gear expendables basecamp supplies rent rental' },
  { label: 'Stages', href: '/stages', keywords: 'sound stage shooting space sun valley lankershim led volume' },
  { label: 'Standing Sets', href: '/standing-sets', keywords: 'sets office loft apartment practical location' },
  { label: 'Contact', href: '/contact', keywords: 'phone email address quote inquiry reach us get in touch' },
  { label: 'Help', href: '/help', keywords: 'support faq questions after hours assistance' },
  { label: 'Rental Agreement', href: '/rental-agreement', keywords: 'contract terms sign paperwork agreement' },
  { label: 'Certificate of Insurance', href: '/help#coi', keywords: 'coi insurance certificate additional insured requirements' },
  { label: 'Payment Info', href: '/payment-info', keywords: 'w9 remit bank ach wire card billing pay invoice' },
]

// ── In-process index cache ────────────────────────────────────────
const INDEX_TTL_MS = 60_000
let cache: { at: number; entries: IndexEntry[] } | null = null

const norm = buildHaystack

async function buildIndex(): Promise<IndexEntry[]> {
  const [items, vehicles, spaces] = await Promise.all([
    // EVERY category we actually rent — not just the self-serve subset.
    // Search's job is "do you have X", and the answer is yes long before
    // someone gets round to publishing X to the order form (2026-09-09:
    // walkies and C-Stands were unfindable for exactly that reason).
    // `publicVisible` still decides what a hit can DO, below.
    //
    // The floor stays the rest of the shared gate: archived, uncategorised
    // and un-priced rows are never searchable, because there is nothing
    // truthful to say about them.
    prisma.inventoryItem.findMany({
      where: {
        ...PUBLISHABLE_CANDIDATE_WHERE,
        // Unit-tracked rows ARE the vehicles and stages, carried in the
        // catalog since the AssetCategory merge. They reach search through
        // their own loaders below, with their own pages; indexing them here
        // too listed "Cargo Van w/ Liftgate" twice, once pointing at a
        // contact form.
        trackingMode: 'QUANTITY',
      },
      select: {
        id: true, code: true, description: true, aliases: true, imageUrl: true,
        dailyRate: true, includedFree: true, publicVisible: true, qtyOwned: true,
        category: { select: { slug: true, name: true } },
      },
    }),
    // Owned categories AND listed partner units, from the same loader
    // /vehicles renders — so a partner unit is as findable as our own, and
    // still never names its vendor. Querying vehicleCategory directly (as
    // this did) missed every partner unit.
    getPublicVehicles(),
    prisma.space.findMany({
      where: PUBLIC_SPACE_VISIBLE_WHERE,
      select: {
        id: true, name: true, type: true, description: true,
        photos: { select: { id: true, isPrimary: true }, orderBy: [{ isPrimary: 'desc' }], take: 1 },
      },
    }),
  ])

  const entries: IndexEntry[] = []

  for (const it of items) {
    // $0 without includedFree = missing price → nothing truthful to show.
    if (!hasPublicPrice(it)) continue
    const name = it.description ?? ''
    if (!name) continue
    const orderable = it.publicVisible
    entries.push({
      id: `supply:${it.id}`,
      kind: 'supply',
      label: name,
      sublabel: it.category?.name ?? null,
      // Orderable → the form, already filtered, so the next click is "Add".
      // Otherwise → a request naming the item, which is the honest next
      // step for gear we rent but don't sell self-serve.
      href: orderable
        ? `/order/supplies?q=${encodeURIComponent(name)}`
        : contactPrefillHref(`Availability: ${name}`),
      image: it.imageUrl ? `/api/public/catalog-image/supply/${it.id}` : null,
      action: orderable ? 'order' : 'ask',
      // Ranking inputs only — never rendered.
      inStock: it.qtyOwned > 0,
      haystack: norm(name, it.code, it.category?.name, it.aliases.join(' ')),
    })
  }

  for (const v of vehicles) {
    entries.push({
      id: `vehicle:${v.id}`,
      kind: 'vehicle',
      label: v.name,
      sublabel: v.subtitle || 'Production vehicle',
      href: `/vehicles/${v.slug}`,
      image: v.photoUrl,
      // Every vehicle is a conversation, owned or partner — the /vehicles
      // page is where that starts.
      action: 'ask',
      inStock: true,
      haystack: norm(v.name, v.slug.replace(/-/g, ' '), v.subtitle, 'vehicle truck van'),
    })
  }

  for (const s of spaces) {
    const kind: PublicSearchKind = s.type === 'STANDING_SET' ? 'standing-set' : 'stage'
    entries.push({
      id: `space:${s.id}`,
      kind,
      label: s.name,
      sublabel: kind === 'standing-set' ? 'Standing set' : 'Stage',
      href: kind === 'standing-set' ? '/standing-sets' : '/stages',
      image: s.photos[0] ? `/api/public/catalog-image/space-photo/${s.photos[0].id}` : null,
      action: 'ask',
      inStock: true,
      haystack: norm(s.name, s.description, kind === 'standing-set' ? 'standing set' : 'stage soundstage'),
    })
  }

  for (const p of STATIC_PAGES) {
    entries.push({
      id: `page:${p.href}`,
      kind: 'page',
      label: p.label,
      sublabel: null,
      href: p.href,
      image: null,
      action: 'order',
      inStock: true,
      haystack: norm(p.label, p.keywords),
    })
  }

  return entries
}

async function getIndex(): Promise<IndexEntry[]> {
  const now = Date.now()
  if (cache && now - cache.at < INDEX_TTL_MS) return cache.entries
  const entries = await buildIndex()
  cache = { at: now, entries }
  return entries
}

/** Lower is better: orderable and on the shelf first, phone-call last. */
function readiness(e: IndexEntry): number {
  return (e.action === 'order' ? 0 : 2) + (e.inStock ? 0 : 1)
}

export async function searchPublicSite(query: string, limit = 8): Promise<PublicSearchHit[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const entries = await getIndex()
  // Tokenized + plural-tolerant, shared with the order form's own field
  // so both public search boxes answer a query identically.
  const variants = queryVariants(q)

  const matched = entries.filter((e) => matchesQuery(e.haystack, variants))

  // Kind is a tie-breaker only, so "cargo van" still puts the vehicle above
  // an expendable that merely mentions it.
  const kindRank: Record<PublicSearchKind, number> = {
    vehicle: 0, supply: 0, stage: 1, 'standing-set': 1, page: 2,
  }

  return matched
    .map((e) => ({
      e,
      // Summed placement across every token, so a row that has all of them
      // in its NAME beats one that needed its aliases to qualify.
      score: variants.reduce((sum, vs) => sum + placement(e.label, vs), 0),
    }))
    .sort(
      (a, b) =>
        a.score - b.score ||
        // Coverage without noise: now that search spans the whole catalog,
        // the thing you can order right now, that we have on the shelf,
        // outranks the equally-named row that needs a phone call.
        readiness(a.e) - readiness(b.e) ||
        // Shorter name = less padding around the match = the more precise
        // hit ("Work Light w/stand" over "Standard 1 Line - Table Lamp").
        a.e.label.length - b.e.label.length ||
        kindRank[a.e.kind] - kindRank[b.e.kind] ||
        a.e.label.localeCompare(b.e.label),
    )
    .slice(0, limit)
    .map(({ e }) => {
      const { haystack: _haystack, inStock: _inStock, ...hit } = e
      return hit
    })
}
