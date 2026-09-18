/**
 * Public-site JSON-LD builders.
 *
 *   npx tsx tests/site/structured-data.test.ts
 *   npm run test:structured-data
 *
 * Pure + offline.
 *
 * Structured data fails in two directions and both are worth a test:
 *
 *   TOO QUIET — a builder drops a fact the page renders, so the markup
 *   describes less than the visitor sees and buys nothing.
 *
 *   TOO LOUD — a builder INVENTS one. That is the expensive direction: a
 *   price-on-quote van published as `price: 0` says "free" to every machine
 *   that reads it, and markup that claims what the page does not show is
 *   what gets a site flagged as spam. Most of what follows guards that side.
 */

import {
  BUSINESS_ID,
  breadcrumbJsonLd,
  itemListJsonLd,
  jsonLdGraph,
  rentalOffer,
  rentalProductJsonLd,
} from '../../src/lib/site/structuredData'

const failures: string[] = []

function ok(cond: boolean, why: string): void {
  if (cond) console.log(`  ok — ${why}`)
  else failures.push(why)
}

// ── The offer: a rental, priced per day, or nothing ──────────────────
console.log('\nThe Offer is a LEASE, per day — or it is absent\n')
{
  const offer = rentalOffer(175, '/vehicles/cube-27')
  ok(offer !== null, 'a priced row gets an Offer')
  ok(offer?.price === 175, 'the price is the rate the page prints')
  ok(offer?.priceCurrency === 'USD', 'currency is stated (a bare number is unreadable)')
  ok(
    String(offer?.businessFunction).endsWith('#LeaseOut'),
    'businessFunction says LeaseOut — without it a $175 van reads as FOR SALE',
  )
  const spec = offer?.priceSpecification as { referenceQuantity?: { unitCode?: string; value?: number } }
  ok(spec?.referenceQuantity?.unitCode === 'DAY', 'the reference quantity is DAY — the /day beside the number')
  ok(spec?.referenceQuantity?.value === 1, 'one day, not an unqualified quantity')
  ok((offer?.seller as { '@id'?: string })?.['@id'] === BUSINESS_ID,
    'the seller points at the one LocalBusiness node by @id, never a second copy of it')
  ok(offer?.url === 'https://sirreel.com/vehicles/cube-27', 'the url is absolute — schema must resolve from anywhere')
}

// The expensive direction.
console.log('\nPrice-on-quote publishes NO price, rather than a wrong one\n')
{
  ok(rentalOffer(null, '/vehicles/x') === null, 'a null rate yields no Offer at all')
  ok(rentalOffer(0, '/vehicles/x') === null, 'a ZERO rate yields no Offer — publishing "free" is the failure this guards')
  ok(rentalOffer(undefined, '/vehicles/x') === null, 'an absent rate yields no Offer')
  ok(rentalOffer(-5, '/vehicles/x') === null, 'a negative rate is nonsense and is refused, not passed through')

  const product = rentalProductJsonLd({ name: 'Talent Trailer', path: '/vehicles/talent', dailyRate: null })
  ok(product.offers === undefined, 'and the Product simply carries no offers key')
  ok(product.name === 'Talent Trailer', 'while still describing the thing itself')
}

// ── The product ──────────────────────────────────────────────────────
console.log('\nThe Product says what the page says, and no more\n')
{
  const product = rentalProductJsonLd({
    name: 'Cube 27',
    path: '/vehicles/cube-27',
    description: '  A 16-foot cube with a lift gate.  ',
    images: ['/api/public/catalog-image/vehicle/abc', null, '', '/api/public/catalog-image/vehicle-photo/def'],
    category: 'Production Vehicles',
    dailyRate: 175,
    specs: [
      { label: 'Base vehicle', value: 'Isuzu NPR' },
      { label: 'Fuel', value: '  Diesel  ' },
      { label: 'Lift gate', value: '' },
      { label: 'Model', value: null },
      { label: 'Length', value: undefined },
    ],
  })

  ok(product['@type'] === 'Product', 'it is a Product')
  ok(product['@id'] === 'https://sirreel.com/vehicles/cube-27#product',
    'with a stable @id, so the node can be referenced rather than duplicated')
  ok(product.description === 'A 16-foot cube with a lift gate.', 'the description is trimmed, not padded')

  const images = product.image as string[]
  ok(images.length === 2, 'null and empty image slots are dropped, never emitted as ""')
  ok(images.every((i) => i.startsWith('https://sirreel.com/')), 'every image is absolute')

  const props = product.additionalProperty as { name: string; value: string }[]
  ok(props.length === 2, 'only the specs that HAVE a value become PropertyValues')
  ok(props.some((p) => p.name === 'Fuel' && p.value === 'Diesel'), 'spec values are trimmed')
  ok(!props.some((p) => p.name === 'Lift gate'), 'a blank spec is absent, not present-and-empty')
}

console.log('\nNothing to say → the key is absent, not empty\n')
{
  const bare = rentalProductJsonLd({ name: 'Black Box', path: '/stages/black-box' })
  ok(bare.image === undefined, 'no images → no image key')
  ok(bare.additionalProperty === undefined, 'no specs → no additionalProperty key')
  ok(bare.description === undefined, 'no description → no description key')
  ok(bare.category === undefined, 'no category → no category key')
  ok(rentalProductJsonLd({ name: 'X', path: '/x', description: '   ' }).description === undefined,
    'a whitespace-only description counts as none')
}

// ── Breadcrumbs ──────────────────────────────────────────────────────
console.log('\nBreadcrumbs are positioned and absolute\n')
{
  const crumbs = breadcrumbJsonLd([
    { name: 'SirReel', path: '/' },
    { name: 'Vehicles', path: '/vehicles' },
    { name: 'Cube 27', path: '/vehicles/cube-27' },
  ])
  const items = crumbs?.itemListElement as { position: number; name: string; item: string }[]
  ok(items.length === 3, 'every crumb is present')
  ok(items[0].position === 1 && items[2].position === 3, 'positions are 1-based and in order')
  ok(items[0].item === 'https://sirreel.com/', 'the root crumb resolves to the origin')
  ok(items[2].item === 'https://sirreel.com/vehicles/cube-27', 'the leaf crumb is the page itself')
  ok(breadcrumbJsonLd([]) === null, 'an empty trail is null, not an empty BreadcrumbList')
}

// ── Item lists ───────────────────────────────────────────────────────
console.log('\nA listing page is a catalog OF the detail pages\n')
{
  const list = itemListJsonLd(
    [
      { name: 'Cube 27', path: '/vehicles/cube-27' },
      { name: 'Cargo 20', path: '/vehicles/cargo-20' },
    ],
    'SirReel production vehicles',
  )
  ok(list?.numberOfItems === 2, 'the count matches the entries')
  ok(list?.name === 'SirReel production vehicles', 'the list is named when a name is given')
  const items = list?.itemListElement as { position: number; url: string }[]
  ok(items[0].url === 'https://sirreel.com/vehicles/cube-27', 'entries point at the detail pages, absolute')
  ok(items[1].position === 2, 'positions follow render order')
  ok(itemListJsonLd([]) === null,
    'an EMPTY catalog yields no ItemList — a page volunteering that it has nothing is worse than silence')
}

// ── The graph ────────────────────────────────────────────────────────
console.log('\nOne graph per page; an empty one is no tag at all\n')
{
  const graph = jsonLdGraph([
    rentalProductJsonLd({ name: 'Cube 27', path: '/vehicles/cube-27', dailyRate: 175 }),
    breadcrumbJsonLd([{ name: 'SirReel', path: '/' }]),
    null,
    undefined,
  ])
  ok(graph?.['@context'] === 'https://schema.org', 'the context is stated once, on the graph')
  ok((graph?.['@graph'] as unknown[]).length === 2, 'null and undefined nodes are dropped')
  ok(jsonLdGraph([]) === null, 'no nodes → no graph, so JsonLd renders nothing')
  ok(jsonLdGraph([null, undefined]) === null, 'all-null → no graph')
}

// The one injection path a JSON-LD block has.
console.log('\nA description cannot break out of the script tag\n')
{
  const product = rentalProductJsonLd({
    name: 'Cube 27',
    path: '/vehicles/cube-27',
    description: 'Ends here </script><script>alert(1)</script>',
  })
  const rendered = JSON.stringify(jsonLdGraph([product])).replace(/</g, '\\u003c')
  ok(!rendered.includes('</script'), 'every "<" is escaped, so no closing tag survives serialization')
  ok(rendered.includes('\\u003c/script'), 'it is escaped rather than stripped — the text is preserved')
}

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All structured-data checks passed.')
