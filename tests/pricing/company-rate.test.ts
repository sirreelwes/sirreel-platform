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
import { overlayCompanyRate, negotiated } from '../../src/lib/pricing/companyRate'

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

console.log('')
if (failures.length) {
  console.error(`FAILED (${failures.length}):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All company-rate cases passed.')
