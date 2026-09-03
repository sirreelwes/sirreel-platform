'use client'

/**
 * The yard board's client half — day switching, refresh, and the cards.
 *
 * Design rules, all of them in service of "the crew is holding a phone
 * in a loading bay" (Wes, 2026-09-02):
 *   - ONE action per card. No menus, no secondary links. The button says
 *     the verb: Inspect / Start pick / Count in.
 *   - Nothing to configure. No filters, no sort, no status picker. The
 *     board decides the order: unfinished work first.
 *   - Finished groups collapse to a single line so the screen shrinks as
 *     the day goes, instead of growing.
 *   - Every tap target clears 44px.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { YardBoard as Board, YardGroup, YardRow } from '@/lib/yard/board'

const PULL_THRESHOLD = 70

const STATE_CHIP: Record<YardRow['state'], string> = {
  todo: 'bg-amber-950/60 border-amber-800 text-amber-300',
  doing: 'bg-blue-950/60 border-blue-800 text-blue-300',
  done: 'bg-emerald-950/60 border-emerald-800 text-emerald-400',
  flag: 'bg-rose-950/60 border-rose-800 text-rose-300',
}

function dayLabel(ymd: string, today: string, tomorrow: string): string {
  if (ymd === today) return 'Today'
  if (ymd === tomorrow) return 'Tomorrow'
  const [y, m, d] = ymd.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000)
  return t.toISOString().slice(0, 10)
}

function RowCard({ row }: { row: YardRow }) {
  // A row with no work left is quiet: dimmed card, plain-text button.
  const done = row.state === 'done'
  return (
    <a
      href={row.href}
      className={`flex items-center gap-3 rounded-xl border p-3.5 min-h-[44px] transition-colors ${
        done
          ? 'bg-zinc-900/40 border-zinc-800 active:border-zinc-700'
          : 'bg-zinc-800 border-zinc-700 active:border-amber-600 hover:border-zinc-600'
      }`}
    >
      <span className="text-xl leading-none flex-none" aria-hidden>
        {row.kind === 'VEHICLE' ? '🚚' : '📦'}
      </span>
      <span className="min-w-0 flex-1">
        {/* Title and detail stack rather than sharing a line: on a 375px
            phone "Unit Cargo 37 · Cargo Van w/ Liftgate" truncated to
            "Unit Cargo 37 · Cargo …", which is the half nobody needed. */}
        <span className="block text-white font-semibold text-[15px] truncate">{row.title}</span>
        <span className="block text-zinc-500 text-xs truncate">{row.detail}</span>
        <span className="mt-1.5 flex items-center gap-2 flex-wrap">
          <span className={`inline-block text-[11px] font-medium rounded-full border px-2 py-0.5 ${STATE_CHIP[row.state]}`}>
            {row.stateLabel}
          </span>
          {row.time && <span className="text-zinc-500 text-[11px]">{row.time}</span>}
        </span>
        {row.progress !== null && row.progress > 0 && row.progress < 100 && (
          <span className="mt-2 block h-1 w-full rounded-full bg-zinc-700 overflow-hidden">
            <span className="block h-full bg-amber-500" style={{ width: `${row.progress}%` }} />
          </span>
        )}
      </span>
      {/* One verb, kept short enough that it never squeezes the row on a
          phone. What state the thing is in is the chip's job, not the
          button's. */}
      <span
        className={`flex-none text-[12px] font-semibold rounded-lg px-3 py-2 ${
          done ? 'text-zinc-500' : 'bg-amber-600 text-white'
        }`}
      >
        {row.action}
      </span>
    </a>
  )
}

function GroupCard({ group }: { group: YardGroup }) {
  // Shows with nothing outstanding collapse by default — the board
  // should get shorter as the day goes, not longer.
  const [open, setOpen] = useState(group.openCount > 0 || group.flagCount > 0)
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-left active:bg-zinc-800/60"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-white font-semibold truncate">{group.jobName}</span>
          <span className="block text-zinc-500 text-xs truncate">{group.company}</span>
        </span>
        <span
          className={`flex-none text-[11px] font-semibold rounded-full px-2.5 py-1 border ${
            group.flagCount > 0
              ? 'bg-rose-950/60 border-rose-800 text-rose-300'
              : group.openCount > 0
                ? 'bg-amber-950/60 border-amber-800 text-amber-300'
                : 'bg-emerald-950/60 border-emerald-800 text-emerald-400'
          }`}
        >
          {group.flagCount > 0 ? '⚠ Short' : group.openCount > 0 ? `${group.openCount} to do` : '✓ Done'}
        </span>
        <span className="flex-none text-zinc-600 text-sm">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {group.rows.map((r) => (
            <RowCard key={`${r.kind}-${r.id}`} row={r} />
          ))}
        </div>
      )}
    </section>
  )
}

function Lane({ title, groups, empty }: { title: string; groups: YardGroup[]; empty: string }) {
  const open = groups.reduce((n, g) => n + g.openCount, 0)
  return (
    <section>
      <h2 className="text-zinc-400 text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-2">
        {title}
        {open > 0 && (
          <span className="text-amber-400 normal-case tracking-normal font-medium">{open} to do</span>
        )}
      </h2>
      {groups.length === 0 ? (
        <p className="text-zinc-500 text-sm bg-zinc-900/40 border border-dashed border-zinc-800 rounded-xl px-4 py-6 text-center">
          {empty}
        </p>
      ) : (
        <div className="space-y-2.5">
          {groups.map((g) => (
            <GroupCard key={g.key} group={g} />
          ))}
        </div>
      )}
    </section>
  )
}

export function YardBoard({ initial, today }: { initial: Board; today: string }) {
  const [data, setData] = useState<Board>(initial)
  const [date, setDate] = useState(initial.date)
  const [refreshing, setRefreshing] = useState(false)
  const [pull, setPull] = useState(0)
  const touchStartY = useRef<number | null>(null)
  const tomorrow = shiftYmd(today, 1)

  const load = useCallback(async (ymd: string) => {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/yard?date=${ymd}`, { cache: 'no-store' })
      if (res.ok) setData(await res.json())
    } catch {
      // yard wifi drops constantly — keep the last good board on screen
    } finally {
      setRefreshing(false)
    }
  }, [])

  // Re-read whenever the day changes, and whenever the crew comes back
  // to the tab after doing something on another screen.
  useEffect(() => {
    if (date !== initial.date) void load(date)
  }, [date, initial.date, load])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(date)
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [date, load])

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = window.scrollY <= 0 ? e.touches[0].clientY : null
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current == null) return
    const dy = e.touches[0].clientY - touchStartY.current
    setPull(dy > 0 ? Math.min(dy, PULL_THRESHOLD * 1.5) : 0)
  }
  const onTouchEnd = () => {
    if (pull >= PULL_THRESHOLD) void load(date)
    setPull(0)
    touchStartY.current = null
  }

  const totalOpen =
    data.out.reduce((n, g) => n + g.openCount, 0) + data.back.reduce((n, g) => n + g.openCount, 0)

  return (
    <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {(pull > 0 || refreshing) && (
        <p className="text-center text-zinc-500 text-xs mb-2">
          {refreshing ? 'Refreshing…' : pull >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}
        </p>
      )}

      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => setDate(shiftYmd(date, -1))}
          aria-label="Previous day"
          className="min-h-[44px] w-11 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 active:bg-zinc-700"
        >
          ‹
        </button>
        <div className="flex-1 text-center">
          <div className="text-white font-semibold">{dayLabel(date, today, tomorrow)}</div>
          <div className="text-zinc-500 text-[11px]">{date}</div>
        </div>
        <button
          type="button"
          onClick={() => setDate(shiftYmd(date, 1))}
          aria-label="Next day"
          className="min-h-[44px] w-11 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 active:bg-zinc-700"
        >
          ›
        </button>
        <button
          type="button"
          onClick={() => void load(date)}
          disabled={refreshing}
          className="min-h-[44px] px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 active:bg-zinc-700 disabled:opacity-50"
          aria-label="Refresh"
        >
          ↻
        </button>
      </div>

      {date !== today && (
        <button
          type="button"
          onClick={() => setDate(today)}
          className="mb-3 w-full min-h-[44px] rounded-lg border border-zinc-700 bg-zinc-800/60 text-zinc-300 text-sm active:bg-zinc-700"
        >
          ← Back to today
        </button>
      )}

      <p className="text-zinc-500 text-xs mb-4">
        {totalOpen === 0
          ? 'Nothing outstanding — the whole day is clear.'
          : `${totalOpen} thing${totalOpen === 1 ? '' : 's'} still to do.`}
      </p>

      <div
        className="space-y-7"
        style={{ transform: pull > 0 ? `translateY(${pull / 3}px)` : undefined }}
      >
        <Lane title="Going out" groups={data.out} empty="Nothing going out." />
        <Lane title="Coming back" groups={data.back} empty="Nothing coming back." />
      </div>
    </div>
  )
}
