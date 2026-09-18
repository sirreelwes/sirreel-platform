/**
 * Client rate card — overlay rules.
 *
 *   npx tsx tests/pricing/company-rate.test.ts
 *   npm run test:company-rate
 *
 * Pure + offline: no DB, no env. These rules decide what a CLIENT is
 * billed, so the cases that matter are the ones where being wrong is
 * silent money:
 *
 *   - a blank/zero negotiated field must fall back to the catalog, never
 *     quote $0 (an empty rate box saved as 0 would ship a free van)
 *   - a deal struck on the daily must NOT blank the weekly, or a
 *     weekly-billed line for that client falls through to unpriced
 *   - a negotiated rate ABOVE list is still their rate — some deals are
 *     premium units, and silently clamping to list would misquote
 */

import { Prisma } from '@prisma/client'
import { overlayCompanyRate, negotiated, clientPrice } from '../../src/lib/pricing/companyRate'

const D = (v: string | number | null) => (v === null ? null : new Prisma.Decimal(v))
const failures: string[] = []

function check(
  why: string,
  catalog: { dailyRate: string | number | null; weeklyRate: string | number | null },
  company: { dailyRate: string | number | null; weeklyRate: string | number | null } | null,
  want: { daily: string | null; weekly: string | null; dailyFromCompany: boolean },
): void {
  const got = overlayCompanyRate(
    { dailyRate: D(catalog.dailyRate), weeklyRate: D(catalog.weeklyRate) },
    company ? { dailyRate: D(company.dailyRate), weeklyRate: D(company.weeklyRate) } : null,
  )
  const gotDaily = got.dailyRate?.toFixed(2) ?? null
  const gotWeekly = got.weeklyRate?.toFixed(2) ?? null
  const wantDaily = want.daily == null ? null : new Prisma.Decimal(want.daily).toFixed(2)
  const wantWeekly = want.weekly == null ? null : new Prisma.Decimal(want.weekly).toFixed(2)
  if (gotDaily === wantDaily && gotWeekly === wantWeekly && got.dailyFromCompany === want.dailyFromCompany) {
    console.log(`  ok — ${why}`)
  } else {
    failures.push(
      `${why}: got ${gotDaily}/d ${gotWeekly}/w (fromCompany=${got.dailyFromCompany}), ` +
      `wanted ${wantDaily}/d ${wantWeekly}/w (fromCompany=${want.dailyFromCompany})`,
    )
  }
}

console.log('Client rate card overlay\n')

// The case that started this: CMS on a Cargo Van w/ Liftgate.
check(
  'negotiated daily replaces list',
  { dailyRate: 170, weeklyRate: 1000 },
  { dailyRate: 130, weeklyRate: null },
  { daily: '130', weekly: '1000', dailyFromCompany: true },
)

check(
  'no rate card at all → catalog untouched',
  { dailyRate: 170, weeklyRate: 1000 },
  null,
  { daily: '170', weekly: '1000', dailyFromCompany: false },
)

// An empty box that saved as 0 must NOT quote a free van.
check(
  'zero negotiated daily falls back to list',
  { dailyRate: 170, weeklyRate: 1000 },
  { dailyRate: 0, weeklyRate: null },
  { daily: '170', weekly: '1000', dailyFromCompany: false },
)

check(
  'negative negotiated daily falls back to list',
  { dailyRate: 170, weeklyRate: 1000 },
  { dailyRate: -40, weeklyRate: null },
  { daily: '170', weekly: '1000', dailyFromCompany: false },
)

// Per-field is the whole point — a daily-only deal keeps the weekly.
check(
  'daily-only deal does not blank the weekly',
  { dailyRate: 170, weeklyRate: 1000 },
  { dailyRate: 130, weeklyRate: 0 },
  { daily: '130', weekly: '1000', dailyFromCompany: true },
)

check(
  'weekly-only deal leaves the daily at list',
  { dailyRate: 170, weeklyRate: 1000 },
  { dailyRate: null, weeklyRate: 800 },
  { daily: '170', weekly: '800', dailyFromCompany: false },
)

// Above list is legitimate — do not clamp.
check(
  'negotiated rate above list is still their rate',
  { dailyRate: 170, weeklyRate: 1000 },
  { dailyRate: 195, weeklyRate: null },
  { daily: '195', weekly: '1000', dailyFromCompany: true },
)

// A negotiated rate prices a row the catalog never did.
check(
  'unpriced catalog item + negotiated rate is priced',
  { dailyRate: null, weeklyRate: null },
  { dailyRate: 130, weeklyRate: null },
  { daily: '130', weekly: null, dailyFromCompany: true },
)

check(
  'unpriced catalog item, no deal, stays unpriced',
  { dailyRate: null, weeklyRate: null },
  null,
  { daily: null, weekly: null, dailyFromCompany: false },
)

// Cents survive the round-trip — a deal struck at $127.50 must not
// become $128 on the quote.
check(
  'sub-dollar precision is preserved',
  { dailyRate: 170, weeklyRate: 1000 },
  { dailyRate: '127.50', weeklyRate: null },
  { daily: '127.50', weekly: '1000', dailyFromCompany: true },
)

console.log('\nnegotiated() guard')
for (const [input, want] of [[null, false], [0, false], [-1, false], [0.01, true], [130, true]] as const) {
  const got = negotiated(input === null ? null : new Prisma.Decimal(input)) != null
  if (got === want) console.log(`  ok — ${String(input)} → ${want ? 'counts' : 'ignored'}`)
  else failures.push(`negotiated(${String(input)}) → ${got}, wanted ${want}`)
}

console.log('\nclientPrice — the ONE rule the typeahead, the kit-piece rule')
console.log('and resolveRate all price a client\'s line with\n')

function price(
  why: string,
  catalog: { dailyRate: string | number | null; weeklyRate: string | number | null },
  card: { dailyRate: string | number | null; weeklyRate: string | number | null } | null,
  standing: { label: string; percentOff: number } | null,
  want: { daily: string | null; weekly: string | null; source: string; negotiated: boolean; dealLabel: string | null },
): void {
  const got = clientPrice(
    { dailyRate: D(catalog.dailyRate), weeklyRate: D(catalog.weeklyRate) },
    card ? { dailyRate: D(card.dailyRate), weeklyRate: D(card.weeklyRate) } : null,
    standing,
  )
  const gotDaily = got.dailyRate?.toFixed(2) ?? null
  const gotWeekly = got.weeklyRate?.toFixed(2) ?? null
  const wantDaily = want.daily == null ? null : new Prisma.Decimal(want.daily).toFixed(2)
  const wantWeekly = want.weekly == null ? null : new Prisma.Decimal(want.weekly).toFixed(2)
  if (
    gotDaily === wantDaily && gotWeekly === wantWeekly &&
    got.source === want.source && got.negotiated === want.negotiated &&
    got.dealLabel === want.dealLabel
  ) {
    console.log(`  ok — ${why}`)
  } else {
    failures.push(
      `${why}: got ${gotDaily}/d ${gotWeekly}/w ${got.source} negotiated=${got.negotiated} label=${got.dealLabel}, ` +
      `wanted ${wantDaily}/d ${wantWeekly}/w ${want.source} negotiated=${want.negotiated} label=${want.dealLabel}`,
    )
  }
}

const CUBES = { label: 'Cube trucks & cargo vans', percentOff: 20 }

// The bug this rule was extracted to kill: the typeahead pre-filled list
// on an item-scoped standing discount, so the rep quoted list and the
// server flagged the line as an override nobody made.
price(
  'standing discount alone cuts the rate, and names itself',
  { dailyRate: 170, weeklyRate: 1000 },
  null,
  CUBES,
  { daily: '136', weekly: '800', source: 'COMPANY_DISCOUNT', negotiated: true, dealLabel: CUBES.label },
)

// Never twice. A negotiated price IS the deal.
price(
  'rate card WINS — the standing discount stands down, no double dip',
  { dailyRate: 170, weeklyRate: 1000 },
  { dailyRate: 130, weeklyRate: null },
  CUBES,
  { daily: '130', weekly: '1000', source: 'COMPANY_RATE', negotiated: true, dealLabel: null },
)

// A card that priced ONLY the weekly still wins outright — otherwise the
// daily would take 20% off a row the client already negotiated.
price(
  'a weekly-only rate card still blocks the discount on the daily',
  { dailyRate: 170, weeklyRate: 1000 },
  { dailyRate: null, weeklyRate: 900 },
  CUBES,
  { daily: '170', weekly: '900', source: 'COMPANY_RATE', negotiated: true, dealLabel: null },
)

// A zero in a rate-card column means "not negotiated", never "free" — so
// the standing discount is still the client's deal on that item.
price(
  'an empty (zero) rate card row does NOT block the standing discount',
  { dailyRate: 170, weeklyRate: 1000 },
  { dailyRate: 0, weeklyRate: 0 },
  CUBES,
  { daily: '136', weekly: '800', source: 'COMPANY_DISCOUNT', negotiated: true, dealLabel: CUBES.label },
)

price(
  'no deal of either kind → list, and the picker strikes nothing through',
  { dailyRate: 170, weeklyRate: 1000 },
  null,
  null,
  { daily: '170', weekly: '1000', source: 'LIST', negotiated: false, dealLabel: null },
)

// An unpriced catalog row cannot be discounted into a deal — striking
// through a blank rate would read as "their price is $0".
price(
  'unpriced item + standing discount stays unpriced, NOT negotiated',
  { dailyRate: null, weeklyRate: null },
  null,
  CUBES,
  { daily: null, weekly: null, source: 'LIST', negotiated: false, dealLabel: null },
)

price(
  'a 0% row is not a deal',
  { dailyRate: 170, weeklyRate: 1000 },
  null,
  { label: 'Nothing off', percentOff: 0 },
  { daily: '170', weekly: '1000', source: 'LIST', negotiated: false, dealLabel: null },
)

// Cents round HALF_UP at the boundary like every other money path —
// 20% off $127.55 is $102.04, not $102.
price(
  'the cut rounds half-up to cents',
  { dailyRate: '127.55', weeklyRate: null },
  null,
  CUBES,
  { daily: '102.04', weekly: null, source: 'COMPANY_DISCOUNT', negotiated: true, dealLabel: CUBES.label },
)

console.log('')
if (failures.length) {
  console.error(`FAILED (${failures.length}):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All company-rate cases passed.')
