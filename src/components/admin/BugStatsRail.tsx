/**
 * The tally beside the bug board — what people have found, and what has
 * been done about it (Wes 2026-09-19).
 *
 * Server component: it only renders numbers `bugStats()` already worked
 * out. What each number MEANS is decided in src/lib/bugs/stats.ts, not
 * here, so the tiles cannot drift from the definitions.
 *
 * Sticky on desktop so the tally stays put while the list scrolls; on a
 * phone it collapses to a two-up grid ABOVE the list, where it reads as a
 * summary instead of a footer nobody scrolls to.
 */

import { Bug, CheckCircle2, ListTodo, MessageCircleQuestion, Timer } from 'lucide-react'
import { humanDays, type BugStats } from '@/lib/bugs/stats'

function Tile({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  sub: string
  icon: typeof Bug
  tone?: 'good' | 'warn'
}) {
  const valueTone =
    tone === 'good' ? 'text-chip-good-fg' : tone === 'warn' ? 'text-chip-warn-fg' : 'text-lt-fg'
  return (
    <div className="rounded-lg border border-lt-hairline bg-lt-card p-4">
      <div className="flex items-center gap-1.5 text-[12px] text-lt-fg2">
        <Icon className="w-3.5 h-3.5 shrink-0 text-lt-fg3" />
        {label}
      </div>
      <div className={`mt-1 text-[26px] font-semibold leading-tight tabular-nums ${valueTone}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-lt-fg3">{sub}</div>
    </div>
  )
}

export function BugStatsRail({ stats }: { stats: BugStats }) {
  const {
    reports, reportsRecent, issues, open, openBlocking,
    fixed, fixedRecent, answered, escalated, medianDaysToFix,
  } = stats

  const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

  return (
    <aside className="order-first lg:order-none grid grid-cols-2 gap-3 lg:grid-cols-1 lg:sticky lg:top-6">
      <Tile
        icon={Bug}
        label="Reported"
        value={reports.toLocaleString('en-US')}
        // Both numbers are true and they differ once anyone reports a
        // repeat; saying which is which is the whole point of the tile.
        sub={
          reports === 0
            ? 'nothing reported yet'
            : issues === reports
              ? `${reportsRecent} in the last 30 days`
              : `${issues} distinct ${plural(issues, 'issue')} · ${reportsRecent} in 30 days`
        }
      />
      <Tile
        icon={CheckCircle2}
        label="Fixed"
        value={fixed.toLocaleString('en-US')}
        tone={fixed > 0 ? 'good' : undefined}
        sub={fixed === 0 ? 'none marked fixed yet' : `${fixedRecent} in the last 30 days`}
      />
      <Tile
        icon={ListTodo}
        label="Still to do"
        value={open.toLocaleString('en-US')}
        tone={openBlocking > 0 ? 'warn' : undefined}
        sub={
          open === 0
            ? 'the list is clear'
            : openBlocking > 0
              ? `${openBlocking} blocking`
              : `${escalated} sent to Wes`
        }
      />
      <Tile
        icon={MessageCircleQuestion}
        label="Answered on the spot"
        value={answered.toLocaleString('en-US')}
        sub={answered === 0 ? 'none yet' : 'nothing needed fixing'}
      />
      {medianDaysToFix !== null && (
        <div className="col-span-2 lg:col-span-1">
          <Tile
            icon={Timer}
            label="Typical time to fix"
            value={humanDays(medianDaysToFix)}
            sub="median, report to fixed"
          />
        </div>
      )}
    </aside>
  )
}
