/**
 * Annual-agreement coverage window — when does a filed master actually stop
 * asking a client to sign?
 *
 *   npx tsx tests/agreements/annual-coverage.test.ts
 *   npm run test:annual-coverage
 *
 * Pure + offline: no DB, no env. `isCoverageCurrent` is the whole decision —
 * everything downstream (the portal banner, the job page, whether a signature
 * pad is shown at all) is derived from it — and both failure directions are
 * expensive in a way a UI bug is not:
 *
 *   - A false TRUE stops asking for signatures on the strength of an expired
 *     or not-yet-effective document. Gear goes out papered by nothing.
 *   - A false FALSE asks an annual account to sign per job, which is exactly
 *     the ask this feature exists to remove.
 *
 * The off-by-one that matters is the expiry DAY: an agreement expiring
 * 2026-12-31 must still cover a job on 2026-12-31, because these are calendar
 * dates, not instants.
 */

import { isCoverageCurrent } from '../../src/lib/orders/annualCoverage'

const failures: string[] = []

type Row = Parameters<typeof isCoverageCurrent>[0]

function check(row: Row, now: string, want: boolean, why: string): void {
  const got = isCoverageCurrent(row, new Date(now))
  if (got === want) {
    console.log(`  ok — ${why}`)
  } else {
    failures.push(`${why}: got ${got}, wanted ${want} (as of ${now})`)
  }
}

const d = (s: string) => new Date(s)

const annual = (over: Partial<Row> = {}): Row => ({
  autoCoverJobs: true,
  deletedAt: null,
  effectiveDate: d('2026-01-01T00:00:00Z'),
  expiryDate: d('2026-12-31T00:00:00Z'),
  ...over,
})

console.log('Annual agreement coverage window\n')

// ── The opt-in is required ────────────────────────────────────────
// A master filed as a RECORD (last year's, a countersigned copy) must never
// stop us asking for signatures just by existing.
check(annual({ autoCoverJobs: false }), '2026-06-01T12:00:00Z', false, 'not flagged → no coverage')
check(annual({ deletedAt: d('2026-05-01T00:00:00Z') }), '2026-06-01T12:00:00Z', false, 'soft-deleted → no coverage')

// ── Inside the window ─────────────────────────────────────────────
check(annual(), '2026-06-01T12:00:00Z', true, 'mid-term')
check(annual(), '2026-01-01T00:00:00Z', true, 'first instant of the effective day')

// ── The expiry day is INCLUSIVE ───────────────────────────────────
// The bug this guards: comparing a bare @db.Date expiry against now() makes
// the agreement lapse at midnight ON its final day, so a job picking up the
// morning of 12/31 is suddenly asked to sign.
check(annual(), '2026-12-31T00:00:01Z', true, 'midnight on the expiry day still covers')
check(annual(), '2026-12-31T23:59:59Z', true, 'last second of the expiry day still covers')
check(annual(), '2027-01-01T00:00:01Z', false, 'the day after expiry does not cover')

// ── Not yet effective ─────────────────────────────────────────────
// Next year's master, filed early. Flagged, but it must not cover today.
check(annual(), '2025-12-31T23:00:00Z', false, 'before the effective date')

// ── Open-ended terms ──────────────────────────────────────────────
// Evergreen masters are real: no expiry means it runs until someone unflags it.
check(annual({ expiryDate: null }), '2030-01-01T00:00:00Z', true, 'no expiry → runs on')
// No effective date either — flagged is the whole instruction.
check(
  annual({ effectiveDate: null, expiryDate: null }),
  '2026-06-01T12:00:00Z',
  true,
  'no dates at all → flagged means covering',
)
// An expiry with no effective date still expires.
check(
  annual({ effectiveDate: null }),
  '2027-06-01T12:00:00Z',
  false,
  'no effective date, past expiry → lapsed',
)

console.log('')
if (failures.length) {
  console.error(`FAILED (${failures.length}):`)
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('All annual-coverage cases pass.')
