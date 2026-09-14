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
import { TENT_ACCESSORY_SLOTS, orderTentFirst } from '@/lib/sales/tentFirst'
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
        // `type` is carried for the add-to-cart payload, not for display:
        // it decides whether a line prices per-day (EQUIPMENT) or flat.
        type: true,
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
    // A $0 row that survived hasPublicPrice is an intentional no-charge
    // inclusion (recycle bins). The order form shows those as "Included"
    // and refuses to add them — it comes WITH an order, it isn't a line —
    // so search must not offer a "+" the form itself wouldn't.
    const included = Number(it.dailyRate) === 0 && it.includedFree
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
      // Same gate as the row's href: if it isn't on the form, it can't be
      // added from search either. Slug (not name) for `category` to match
      // what /api/public/catalog hands the order form, so a line added
      // here and one added there group together in the cart panel.
      add:
        orderable && !included
          ? {
              itemKind: 'SUPPLY',
              itemId: it.id,
              name,
              price: Number(it.dailyRate),
              type: it.type,
              category: it.category?.slug ?? 'other',
            }
          : null,
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
      // page is where that starts, and the click still goes there (the
      // photos and specs are why a client clicks a truck). The "+" is the
      // shortcut past it for someone who already knows what they need.
      action: 'ask',
      // OWNED categories only. `getPublicVehicles` also returns listed
      // partner units, whose `id` is a SubcontractedVehicle — and
      // /api/public/supply-request resolves VEHICLE lines against
      // VehicleCategory, so a partner "+" would blow up at submit, after
      // the client had filled in the entire details form. Partner units
      // keep their page, which works.
      add: v.partner
        ? null
        : {
            itemKind: 'VEHICLE',
            itemId: v.id,
            // Same name shape the order form's vehicle card adds.
            name: v.name + (v.subtitle ? ` (${v.subtitle})` : ''),
            price: v.dailyRate ?? 0,
            type: 'VEHICLE',
            category: 'Vehicle',
          },
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
      // A stage is a date negotiation, not a shelf item.
      add: null,
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
      add: null,
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

  const ranked = matched
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
    .map(({ e }) => e)

  // Tent first, accessories next (Wes 2026-09-14) — the THIRD ranking path
  // that needed this, after the staff typeahead and the supply order form.
  // A sidewall is named "Canopy Tent Sidewall - 10' Blue", so on "tent" it
  // scores a name hit AND wins the shorter-name tiebreak above, which put
  // seven sidewalls above the first canopy in the site-wide box. Same rule
  // as the other two, so all three boxes answer "tent" the same way; the
  // reserve keeps the sidewalls reachable inside a limit of 8 rather than
  // letting ~30 canopy rows bury them. A no-op on every other query.
  return orderTentFirst(ranked, q, {
    name: (e) => e.label,
    limit,
    minAccessories: TENT_ACCESSORY_SLOTS,
  })
    .slice(0, limit)
    .map((e) => {
      const { haystack: _haystack, inStock: _inStock, ...hit } = e
      return hit
    })
}
