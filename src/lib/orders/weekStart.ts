/**
 * Monday-of-the-week computation in Pacific time, returned as a
 * `YYYY-MM-DD` Date at midnight. Used by the AgentWeeklyCandid
 * "this week" lookup so a rep who uploads Monday morning vs Friday
 * night still maps to the same Monday-keyed row for the week.
 */

const PACIFIC_TZ = 'America/Los_Angeles'

export function weekStartPacific(now: Date = new Date()): Date {
  // Get year/month/day in Pacific.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  })
  const parts = fmt.formatToParts(now)
  const y = Number(parts.find((p) => p.type === 'year')?.value ?? '1970')
  const m = Number(parts.find((p) => p.type === 'month')?.value ?? '01')
  const d = Number(parts.find((p) => p.type === 'day')?.value ?? '01')
  const weekdayShort = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'
  const WEEKDAY_OFFSET: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  }
  const offset = WEEKDAY_OFFSET[weekdayShort] ?? 0
  const date = new Date(Date.UTC(y, m - 1, d - offset))
  return date
}
