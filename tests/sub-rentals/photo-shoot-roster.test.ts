/**
 * The Photo Shoot Rentals section, built from VSM Planet's gear
 * (2026-09-16) — the roster the onboarding script seeds, and the wiring it
 * lands on, asserted:
 *
 *   · every unit sits in PHOTO_SHOOT, so the section on /vehicles is the
 *     one they render under and nothing lands in Specialty Vehicles;
 *   · a VSM unit quotes under the PHOTO_SHOOT department — the thing that
 *     gives it its own heading and subtotal on the quote;
 *   · VSM's units are WILL_CALL and ask the partner for NO driver (a stills
 *     rental house is a counter business);
 *   · no unit ships with a rate — partners propose, HQ accepts;
 *   · nothing client-facing names the partner or carries a price;
 *   · EVERY line-item department prints under a heading on the pick list.
 *     PHOTO_SHOOT is a warehouse department, and PickListDocument's label
 *     map had been left behind when it was added — an owned photo-shoot
 *     line grouped under `undefined` on the paper the floor pulls from.
 *   · gear SirReel itself carries in the department bills a 3-day week.
 *
 * Run: npm run test:photo-section
 */
import { FEATURED_FIRST, VSM_PLANET, VSM_PLANET_NAME, VSM_PLANET_ROSTER, rosterByType } from '@/lib/sub-rentals/photoShootRoster'
import { isPartnerSectionKey, partnerSection, partnerUnitDepartment, resolvePartnerSection } from '@/lib/site/partnerSections'
import { defaultReceiveMethodFor, usesPartnerDriver } from '@/lib/sub-rentals/partnerKind'
import { LINE_ITEM_DEPARTMENT_ORDER } from '@/lib/orders/lineItemDepartments'
import { DEPT_LABELS, DEPT_ORDER } from '@/lib/warehouse/PickListDocument'
import { BILLING_RULES } from '@/lib/orders/billing'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)

// ── the section itself ────────────────────────────────────────────────
const photo = partnerSection('PHOTO_SHOOT')
eq('section title', photo.title, 'Photo Shoot Rentals')
eq('section anchor', photo.anchor, 'photo-shoot')
yes('PHOTO_SHOOT is a real section key', isPartnerSectionKey('PHOTO_SHOOT'))

// ── the roster ────────────────────────────────────────────────────────
const names = VSM_PLANET_ROSTER.map((u) => u.name)
yes('the section has gear in it', VSM_PLANET_ROSTER.length > 0)
eq('unit names unique', new Set(names).size, names.length)
yes('every unit is filed under Photo Shoot Rentals', VSM_PLANET_ROSTER.every((u) => u.section === 'PHOTO_SHOOT'))
yes('every unit is in a real section', VSM_PLANET_ROSTER.every((u) => isPartnerSectionKey(u.section)))
yes('every unit says what it is', VSM_PLANET_ROSTER.every((u) => u.vehicleType.length > 2))
yes('every unit has specs', VSM_PLANET_ROSTER.every((u) => u.specs.length >= 3))
yes('every unit has a client blurb', VSM_PLANET_ROSTER.every((u) => u.publicDescription.length > 30))
yes('no unit carries a rate', VSM_PLANET_ROSTER.every((u) => !('listDailyRate' in u) && !('listWeeklyRate' in u)))

// Client-facing text: no vendor name, no money, no driver. A listed unit
// renders specs and the blurb straight onto sirreel.com.
const clientText = VSM_PLANET_ROSTER.map((u) => `${u.specs.join(' ')} ${u.publicDescription}`).join(' ')
yes('client text never names the partner', !/vsm|planet rentals|profoto house/i.test(clientText.replace(/Profoto/g, '')))
yes('client text carries no price', !/\$|\bper day\b|\bdaily rate\b/i.test(clientText))
yes('client text never promises a driver', !/\bdriver\b/i.test(clientText))
yes('the house specialism is named where it helps', /profoto/i.test(names.join(' ')))

// Their Sprinter vans are OUR lane — a partner listed against the house
// fleet is the GreenLite caveat over again.
yes('no sprinter/van unit on the roster', !/sprinter|cargo van|passenger van/i.test(names.join(' ')))

// ── what a VSM unit does on an order ──────────────────────────────────
const vendor = { catalogSection: VSM_PLANET.catalogSection, partnerKind: VSM_PLANET.partnerKind, defaultReceiveMethod: VSM_PLANET.defaultReceiveMethod }
// Units are seeded with a NULL override so they inherit the vendor's.
const unit = { catalogSection: 'PHOTO_SHOOT' as string | null, defaultReceiveMethod: null as string | null }
eq('a VSM unit renders in the photo section', resolvePartnerSection(unit, vendor).key, 'PHOTO_SHOOT')
eq('a VSM unit quotes under PHOTO_SHOOT', partnerUnitDepartment(unit, vendor), 'PHOTO_SHOOT')
eq('the partner default is will-call', defaultReceiveMethodFor(unit, vendor), 'WILL_CALL')
eq('will-call asks the partner for no driver', usesPartnerDriver(defaultReceiveMethodFor(unit, vendor)), false)
// An EQUIPMENT partner outside this section still quotes under G&E — the
// section is what makes it photo, not the partner's kind.
eq('kind alone does not make it photo', partnerUnitDepartment({ catalogSection: 'POWER_GENERATORS' }, vendor), 'GE')

// ── a rep can actually find the gear ──────────────────────────────────
// Mirrors /api/catalog/search's partner-unit clause: tokens split on
// whitespace, every token AND-ed, substring-matched against NAME and
// VEHICLE TYPE only (never specs or the blurb).
const findable = (query: string) =>
  VSM_PLANET_ROSTER.filter((u) => {
    const hay = `${u.name} ${u.vehicleType}`.toLowerCase()
    return query.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t))
  })

eq('"photo" reaches the whole section', findable('photo').length, VSM_PLANET_ROSTER.length)
eq('"photo shoot" reaches the whole section', findable('photo shoot').length, VSM_PLANET_ROSTER.length)
yes('"strobe" still narrows to the strobes', findable('strobe').length > 0 && findable('strobe').length < VSM_PLANET_ROSTER.length)
yes('"backdrop" finds the backings', findable('backdrop').length >= 3)
yes('"profoto" finds the Profoto kits', findable('profoto').length >= 4)
yes('"seamless" finds the paper', findable('seamless').length >= 2)
yes('"c-stand" finds the grip package', findable('c-stand').length === 1)
yes('"camera" finds the camera kit', findable('camera').length >= 1)
yes('"tether" finds the cart', findable('tether').length === 1)
// The section is not a catch-all: a query for gear it does not hold must
// come back empty rather than offering a backdrop.
eq('"generator" finds nothing here', findable('generator').length, 0)

// ── the pick list prints every department ─────────────────────────────
for (const dept of LINE_ITEM_DEPARTMENT_ORDER) {
  yes(`pick list labels ${dept}`, typeof (DEPT_LABELS as Record<string, string>)[dept] === 'string')
  yes(`pick list orders ${dept}`, (DEPT_ORDER as string[]).includes(dept))
}
eq('photo shoot heading on the sheet', (DEPT_LABELS as Record<string, string>).PHOTO_SHOOT, 'Photo Shoot Rentals')

// ── billing ───────────────────────────────────────────────────────────
eq('owned photo gear bills a 3-day week', (BILLING_RULES as Record<string, { model: string; cap?: number }>).PHOTO_SHOOT, { model: 'CAP_PER_WEEK', cap: 3 })

// ── the partner row the script asserts ────────────────────────────────
eq('vendor name is the upsert key', VSM_PLANET.name, VSM_PLANET_NAME)
eq('VSM is an equipment partner', VSM_PLANET.partnerKind, 'EQUIPMENT')
eq('VSM defaults to the photo section', VSM_PLANET.catalogSection, 'PHOTO_SHOOT')
yes('website is https', /^https:\/\//.test(VSM_PLANET.website))
yes('no address is guessed', !('lotAddress' in VSM_PLANET))
yes('no email is guessed', !('email' in VSM_PLANET))
// The deal was recorded in this repo since 2026-09-11 but the vendor row did
// not exist, so the seed carries it. Wes's numbers, not derived.
eq('SirReel\u2019s share of a VSM unit', VSM_PLANET.partnerSharePercent, 35)
eq('the ceiling it may rise to', VSM_PLANET.partnerMaxSharePercent, 43)
yes('the ceiling is above the deal', VSM_PLANET.partnerMaxSharePercent > VSM_PLANET.partnerSharePercent)
yes('both are percentages', [VSM_PLANET.partnerSharePercent, VSM_PLANET.partnerMaxSharePercent].every((n) => n > 0 && n < 100))

// ── the two to feature ────────────────────────────────────────────────
eq('two units are featured', FEATURED_FIRST.length, 2)
yes('every featured name is a real roster unit', FEATURED_FIRST.every((n) => names.includes(n)))
// One light, one background — not two of the same thing.
const featuredTypes = FEATURED_FIRST.map((n) => VSM_PLANET_ROSTER.find((u) => u.name === n)!.vehicleType)
eq('the pair spans two kinds of gear', new Set(featuredTypes).size, 2)
yes('one of them is a light', featuredTypes.some((t) => /lighting/.test(t)))
yes('one of them is a backing', featuredTypes.some((t) => /backdrops/.test(t)))

// ── the grouping the run prints ───────────────────────────────────────
const grouped = rosterByType()
eq('grouping loses nothing', [...grouped.values()].reduce((n, l) => n + l.length, 0), VSM_PLANET_ROSTER.length)
yes('more than one kind of gear', grouped.size > 1)

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
