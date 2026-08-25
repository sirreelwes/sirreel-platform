/**
 * Calendar-date formatting — the regression guard for the day-early bug.
 *
 * Reproduces the real case: a web-form order for 2026-08-26 → 2026-08-28 that
 * HQ displayed as Aug 25 → Aug 27 because the formatter had no timeZone.
 *
 * Runs under a WESTERN zone on purpose (TZ is forced below). In UTC the bug is
 * invisible — which is exactly why it survived — so a test that does not pin
 * the zone proves nothing.
 *
 * Run: npm run test:dates
 */
process.env.TZ = 'America/Los_Angeles'

import { formatCalendarDate, formatCalendarRange, toCalendarDateString } from '@/lib/dates/calendarDate'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

console.log(`(running in TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone})\n`)

// The actual regression.
eq('Giovanna pickup', formatCalendarDate('2026-08-26T00:00:00.000Z'), 'Aug 26, 2026')
eq('Giovanna return', formatCalendarDate('2026-08-28T00:00:00.000Z'), 'Aug 28, 2026')
eq('Giovanna window', formatCalendarRange('2026-08-26T00:00:00.000Z', '2026-08-28T00:00:00.000Z'), 'Aug 26 – Aug 28, 2026')

// A bare YYYY-MM-DD parses as UTC midnight and must survive intact.
eq('bare date string', formatCalendarDate('2026-08-26'), 'Aug 26, 2026')
eq('Date object', formatCalendarDate(new Date('2026-01-01T00:00:00.000Z')), 'Jan 1, 2026')

// Year boundary — the case where local time changes the YEAR, not just the day.
eq('new year eve', formatCalendarDate('2027-01-01T00:00:00.000Z'), 'Jan 1, 2027')
eq('across years', formatCalendarRange('2026-12-30T00:00:00.000Z', '2027-01-02T00:00:00.000Z'), 'Dec 30, 2026 – Jan 2, 2027')

// Single-day and partial ranges.
eq('same day collapses', formatCalendarRange('2026-08-26', '2026-08-26'), 'Aug 26, 2026')
eq('start only', formatCalendarRange('2026-08-26', null), 'Aug 26, 2026')
eq('end only', formatCalendarRange(null, '2026-08-28'), 'Aug 28, 2026')

// Empties and junk fall back rather than printing "Invalid Date".
eq('null', formatCalendarDate(null), '—')
eq('empty string', formatCalendarDate(''), '—')
eq('garbage', formatCalendarDate('not-a-date'), '—')
eq('custom fallback', formatCalendarDate(null, undefined, 'TBD'), 'TBD')
eq('both null range', formatCalendarRange(null, null), '—')

// Custom options still get UTC forced.
eq('long month', formatCalendarDate('2026-08-26', { month: 'long', day: 'numeric', year: 'numeric' }), 'August 26, 2026')
eq('2-digit year', formatCalendarDate('2026-08-26', { month: 'short', day: 'numeric', year: '2-digit' }), 'Aug 26, 26')

// Round-tripping back to YYYY-MM-DD.
eq('to string', toCalendarDateString('2026-08-26T00:00:00.000Z'), '2026-08-26')
eq('to string (null)', toCalendarDateString(null), '')

console.log(fail === 0 ? '\nall calendar-date checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
