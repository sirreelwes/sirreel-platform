/**
 * Period-window math for the Clients-page growth strip.
 *
 * Runs under TZ=UTC on purpose: the server this ships to is UTC, and a
 * boundary bug that only appears when the process clock is east of
 * Pacific is exactly the one that would survive a Pacific-only test.
 *
 * Run: npm run test:growth-windows
 */
process.env.TZ = 'UTC'

import {
  bucketByWindows,
  growthFloor,
  growthWindows,
  pacificDayStart,
  pacificWeekStart,
} from '@/lib/crm/growthWindows'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const iso = (d: Date) => d.toISOString()

// ── Day boundaries. PDT is UTC-7 (Mar–Nov), PST is UTC-8.
eq('summer day start', iso(pacificDayStart(2026, 9, 9)), '2026-09-09T07:00:00.000Z')
eq('winter day start', iso(pacificDayStart(2026, 1, 15)), '2026-01-15T08:00:00.000Z')
// The two DST switch days themselves — the case the single-pass offset
// guess gets wrong.
eq('spring forward day', iso(pacificDayStart(2026, 3, 8)), '2026-03-08T08:00:00.000Z')
eq('fall back day', iso(pacificDayStart(2026, 11, 1)), '2026-11-01T07:00:00.000Z')

// ── Week start is Monday, Pacific.
// Wed Sep 9 2026 → Mon Sep 7.
eq('midweek', iso(pacificWeekStart(new Date('2026-09-09T20:00:00Z'))), '2026-09-07T07:00:00.000Z')
// Sunday 5pm PT = Monday 00:00 UTC. The whole reason this file exists:
// counting in UTC would file this under the week that has not begun.
eq('sunday night PT', iso(pacificWeekStart(new Date('2026-09-07T00:00:00Z'))), '2026-08-31T07:00:00.000Z')
// Monday 00:30 PT is already the new week.
eq('monday just after midnight PT', iso(pacificWeekStart(new Date('2026-09-07T07:30:00Z'))), '2026-09-07T07:00:00.000Z')
// Week that starts before a month boundary.
eq('week crossing month', iso(pacificWeekStart(new Date('2026-10-02T18:00:00Z'))), '2026-09-28T07:00:00.000Z')

// ── Windows. Wednesday Sep 9 2026, 10:00 PT.
const now = new Date('2026-09-09T17:00:00Z')
const [week, month, year] = growthWindows(now)

eq('week window', [iso(week.start), iso(week.priorStart), iso(week.priorEnd)], [
  '2026-09-07T07:00:00.000Z',
  '2026-08-31T07:00:00.000Z',
  // Same elapsed span (2d 10h) into the previous week.
  '2026-09-02T17:00:00.000Z',
])
eq('month window start', iso(month.start), '2026-09-01T07:00:00.000Z')
eq('month prior start', iso(month.priorStart), '2026-08-01T07:00:00.000Z')
eq('year window start', iso(year.start), '2026-01-01T08:00:00.000Z')
eq('year prior start', iso(year.priorStart), '2025-01-01T08:00:00.000Z')
eq('every window ends now', [iso(week.end), iso(month.end), iso(year.end)], [iso(now), iso(now), iso(now)])
// Prior windows never run past the period they belong to.
eq('prior month window shorter than the month', month.priorEnd.getTime() <= month.start.getTime(), true)
eq('prior year window shorter than the year', year.priorEnd.getTime() <= year.start.getTime(), true)
eq('floor is the prior year start', iso(growthFloor(growthWindows(now))), '2025-01-01T08:00:00.000Z')

// January: the prior month is the previous DECEMBER, not month zero.
const jan = growthWindows(new Date('2026-01-10T20:00:00Z'))
eq('january prior month', iso(jan[1].priorStart), '2025-12-01T08:00:00.000Z')

// ── Bucketing. Rows nest: one contact added today counts toward the
// week AND the month AND the year.
const counts = bucketByWindows(
  [
    new Date('2026-09-09T16:00:00Z'), // today
    new Date('2026-09-07T08:00:00Z'), // Monday, this week
    new Date('2026-09-02T08:00:00Z'), // last week, before the prior cut-off
    new Date('2026-09-03T08:00:00Z'), // last week, AFTER it — not counted
    new Date('2026-08-05T08:00:00Z'), // last month, within the to-date window
    new Date('2026-08-20T08:00:00Z'), // last month but PAST the to-date cut
    new Date('2025-06-01T08:00:00Z'), // last year
    new Date('2019-01-01T08:00:00Z'), // ancient, outside every window
  ],
  growthWindows(now),
)
eq('week counts', counts.week, { current: 2, prior: 1 })
eq('month counts', counts.month, { current: 4, prior: 1 })
eq('year counts', counts.year, { current: 6, prior: 1 })

// A row exactly on a boundary belongs to the window that starts there.
const edge = bucketByWindows([new Date('2026-09-07T07:00:00.000Z')], growthWindows(now))
eq('start is inclusive', edge.week.current, 1)

console.log(fail === 0 ? '\nAll growth-window checks passed.' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
