/**
 * "Listed" vs actually ON sirreel.com (2026-09-16).
 *
 * The roster page's Public catalog switch set ONE of the six things
 * `SUB_LISTED_WHERE` tests and then reported success — so a unit with no
 * photo, or a partner who had not signed, read "Listed — anyone browsing
 * sirreel.com can find it" beside a URL that 404'd. Asserted here:
 *
 *   · a unit that meets every condition is live, and nothing is reported;
 *   · each missing condition is named ON ITS OWN, so the card can say which;
 *   · a missing photo and an unsigned partner are reported TOGETHER — the
 *     two that blocked VSM Planet's first units, and the pair most likely
 *     to be fixed in one sitting;
 *   · `blockersBesidesListing` ignores the switch, which is what lets the
 *     card preview the work while the switch is still off;
 *   · the rule and `SUB_LISTED_WHERE` test the same NUMBER of conditions —
 *     the tripwire for someone adding a condition to the where-clause and
 *     not here, which would put the card back to lying.
 *
 * Run: npm run test:public-listing
 */
import { listingBlockers, isPubliclyLive, blockersBesidesListing, type ListingFacts } from '@/lib/sub-rentals/publicListing'
import { SUB_LISTED_WHERE } from '@/lib/site/vehicleCatalog'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)

const LIVE: ListingFacts = {
  offeredToSirReel: true,
  isActive: true,
  publiclyListed: true,
  publicSlug: 'profoto-pack-head-kit-2400-w-s',
  photoCount: 1,
  vendorActive: true,
  vendorHasSignedAgreement: true,
}
const codes = (f: Partial<ListingFacts>) => listingBlockers({ ...LIVE, ...f }).map((b) => b.code)

yes('a unit meeting every condition is live', isPubliclyLive(LIVE))
eq('and reports nothing', codes({}), [])

// One at a time — the card has to be able to say WHICH.
eq('switch off', codes({ publiclyListed: false }), ['not-listed'])
eq('no photo', codes({ photoCount: 0 }), ['no-photo'])
eq('partner has not signed', codes({ vendorHasSignedAgreement: false }), ['no-signed-agreement'])
eq('listed with no slug', codes({ publicSlug: null }), ['no-slug'])
eq('partner keeps it for themselves', codes({ offeredToSirReel: false }), ['not-offered'])
eq('unit retired', codes({ isActive: false }), ['inactive'])
eq('partner inactive', codes({ vendorActive: false }), ['vendor-inactive'])

// The VSM Planet case: seeded, switched on, nothing else done yet.
eq(
  'a freshly seeded unit names both real blockers',
  codes({ photoCount: 0, vendorHasSignedAgreement: false }),
  ['no-photo', 'no-signed-agreement'],
)
yes('and is NOT live', !isPubliclyLive({ ...LIVE, photoCount: 0, vendorHasSignedAgreement: false }))

// A slug missing while the switch is OFF is not yet a problem — the PATCH
// route derives one at the moment of listing.
eq('slug is only asked for once listed', codes({ publiclyListed: false, publicSlug: null }), ['not-listed'])

// Preview while the switch is off.
eq(
  'preview ignores the switch',
  blockersBesidesListing({ ...LIVE, publiclyListed: false, photoCount: 0 }).map((b) => b.code),
  ['no-photo'],
)
eq('preview of a ready unit is empty', blockersBesidesListing({ ...LIVE, publiclyListed: false }), [])

// Every blocker has to be renderable and actionable. No single set of facts
// produces all seven — `not-listed` and `no-slug` are mutually exclusive by
// construction (a slug is only owed once the switch is on) — so the union of
// the two extremes is what covers them.
const nothingDone = listingBlockers({
  offeredToSirReel: false, isActive: false, publiclyListed: false,
  publicSlug: null, photoCount: 0, vendorActive: false, vendorHasSignedAgreement: false,
})
const listedTooEarly = listingBlockers({
  offeredToSirReel: false, isActive: false, publiclyListed: true,
  publicSlug: null, photoCount: 0, vendorActive: false, vendorHasSignedAgreement: false,
})
const all = [...nothingDone, ...listedTooEarly]
const everyCode = new Set(all.map((b) => b.code))
yes('every blocker says what is missing', all.every((b) => b.label.length > 5))
yes('every blocker says what to do', all.every((b) => b.fix.length > 8))
eq('codes are unique within one answer', new Set(nothingDone.map((b) => b.code)).size, nothingDone.length)
yes('the switch and the slug are never both asked for', !(everyCode.has('not-listed') && listedTooEarly.some((b) => b.code === 'not-listed')))

// ── the tripwire ──────────────────────────────────────────────────────
// SUB_LISTED_WHERE's keys ARE the conditions. If one is added there and not
// modelled here, the card silently under-reports again.
const whereKeys = Object.keys(SUB_LISTED_WHERE).sort()
eq('SUB_LISTED_WHERE tests the conditions this rule models', whereKeys, [
  'isActive', 'offeredToSirReel', 'photos', 'publicSlug', 'publiclyListed', 'vendor',
])
// `vendor` carries two conditions of its own (isActive + a signed
// agreement), so six where-keys map to seven distinct blockers. A condition
// added to the where-clause without one here breaks this line.
eq('one blocker per condition', everyCode.size, whereKeys.length + 1)

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
