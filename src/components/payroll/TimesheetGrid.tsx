'use client'

/**
 * The timesheet grid — the screen this whole feature exists for.
 *
 * It deliberately mirrors the paper sheet: employees down the left, days
 * across the top, In / Out / lunch in each cell. Somebody transcribing a page
 * of handwriting should be able to read across the paper and across the screen
 * at the same time without translating between two layouts.
 *
 * Desktop is the primary surface — a two-week grid is a wide thing and
 * pretending otherwise helps nobody. Mobile stacks to one employee per card
 * with a day list, which is a review layout, not a bulk-entry one.
 *
 * Saving is per cell, on blur. Typing a whole row and losing it to a failed
 * request is the failure mode that matters here; each cell commits on its own
 * and the server returns the recomputed grid, so the weekly Reg/OT/DT numbers
 * update as you go and you can see the overtime appear.
 */

import { useCallback, useMemo, useState } from 'react'
import { formatCalendarDate } from '@/lib/dates/calendarDate'
import type { CellPatch, GridCell, GridRow, PeriodGrid } from './types'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00.000Z`)
  return { dow: DOW[d.getUTCDay()], num: d.getUTCDate() }
}

function hrs(n: number) {
  return n === 0 ? '' : n.toFixed(2)
}

interface Props {
  grid: PeriodGrid
  onPatch: (employeeId: string, date: string, patch: CellPatch) => Promise<void>
}

export function TimesheetGrid({ grid, onPatch }: Props) {
  const [openCell, setOpenCell] = useState<{ employeeId: string; date: string } | null>(null)

  return (
    <>
      {/* Desktop: the real grid. */}
      <div className="hidden md:block bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-lt-inner">
                <th className="sticky left-0 z-10 bg-lt-inner text-left font-medium text-lt-fg2 text-xs px-3 py-2 border-b border-r border-lt-hairline min-w-[170px]">
                  Employee
                </th>
                {grid.weeks.map((week) => (
                  <th
                    key={week.weekStart}
                    colSpan={week.days.length + 1}
                    className="text-left font-medium text-lt-fg2 text-xs px-3 py-2 border-b border-l-2 border-l-lt-fg3 border-lt-hairline"
                  >
                    Week of {formatCalendarDate(week.weekStart, { month: 'short', day: 'numeric' })}
                  </th>
                ))}
              </tr>
              <tr className="bg-lt-inner2">
                <th className="sticky left-0 z-10 bg-lt-inner2 border-b border-r border-lt-hairline" />
                {grid.weeks.map((week) => (
                  <WeekHeaderCells key={week.weekStart} days={week.days} />
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <EmployeeRow
                  key={row.employeeId}
                  row={row}
                  grid={grid}
                  openCell={openCell}
                  setOpenCell={setOpenCell}
                  onPatch={onPatch}
                />
              ))}
              <TotalsRow grid={grid} />
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile: one card per person. Review, not bulk entry. */}
      <div className="md:hidden space-y-3">
        {grid.rows.map((row) => (
          <MobileEmployeeCard key={row.employeeId} row={row} grid={grid} onPatch={onPatch} />
        ))}
      </div>
    </>
  )
}

function WeekHeaderCells({ days }: { days: string[] }) {
  return (
    <>
      {days.map((d, i) => {
        const { dow, num } = dayLabel(d)
        return (
          <th
            key={d}
            className={`text-center font-medium text-lt-fg2 text-[11px] px-1 py-1.5 border-b border-lt-hairline min-w-[74px] ${i === 0 ? 'border-l-2 border-l-lt-fg3' : ''}`}
          >
            <div>{dow}</div>
            <div className="text-lt-fg3">{num}</div>
          </th>
        )
      })}
      <th className="text-center font-medium text-lt-fg2 text-[11px] px-2 py-1.5 border-b border-lt-hairline bg-lt-inner min-w-[112px]">
        Reg / OT / DT
      </th>
    </>
  )
}

function EmployeeRow({
  row, grid, openCell, setOpenCell, onPatch,
}: {
  row: GridRow
  grid: PeriodGrid
  openCell: { employeeId: string; date: string } | null
  setOpenCell: (c: { employeeId: string; date: string } | null) => void
  onPatch: Props['onPatch']
}) {
  return (
    <tr className="border-b border-lt-hairline last:border-b-0">
      <th className="sticky left-0 z-10 bg-lt-card text-left align-top px-3 py-2 border-r border-lt-hairline font-medium text-lt-fg">
        <div className="text-sm">{row.fullName}</div>
        {row.title && <div className="text-[11px] text-lt-fg3 font-normal">{row.title}</div>}
      </th>
      {grid.weeks.map((week) => {
        const wt = row.totals.weeks.find((w) => w.weekStart === week.weekStart)
        return (
          <WeekCells
            key={week.weekStart}
            row={row}
            days={week.days}
            editable={grid.editable}
            weekTotals={wt}
            openCell={openCell}
            setOpenCell={setOpenCell}
            onPatch={onPatch}
          />
        )
      })}
    </tr>
  )
}

function WeekCells({
  row, days, editable, weekTotals, openCell, setOpenCell, onPatch,
}: {
  row: GridRow
  days: string[]
  editable: boolean
  weekTotals?: { regHrs: number; otHrs: number; dtHrs: number; sickHrs: number; ptoHrs: number; mealPremiumHrs: number }
  openCell: { employeeId: string; date: string } | null
  setOpenCell: (c: { employeeId: string; date: string } | null) => void
  onPatch: Props['onPatch']
}) {
  return (
    <>
      {days.map((date, i) => (
        <DayCell
          key={date}
          employeeId={row.employeeId}
          date={date}
          cell={row.cells[date]}
          editable={editable}
          firstOfWeek={i === 0}
          expanded={openCell?.employeeId === row.employeeId && openCell?.date === date}
          onToggle={() =>
            setOpenCell(
              openCell?.employeeId === row.employeeId && openCell?.date === date
                ? null
                : { employeeId: row.employeeId, date },
            )
          }
          onPatch={onPatch}
        />
      ))}
      <td className="align-middle text-center px-2 py-1.5 bg-lt-inner/60 text-[11px] leading-tight tabular-nums">
        {weekTotals ? (
          <>
            <div className="text-lt-fg font-medium">{weekTotals.regHrs.toFixed(2)}</div>
            <div className={weekTotals.otHrs > 0 ? 'text-chip-warn-fg font-medium' : 'text-lt-fg3'}>
              {weekTotals.otHrs.toFixed(2)} OT
            </div>
            {weekTotals.dtHrs > 0 && (
              <div className="text-chip-bad-fg font-medium">{weekTotals.dtHrs.toFixed(2)} DT</div>
            )}
            {(weekTotals.sickHrs > 0 || weekTotals.ptoHrs > 0) && (
              <div className="text-lt-fg3">
                {weekTotals.sickHrs > 0 && `${weekTotals.sickHrs.toFixed(1)} sick `}
                {weekTotals.ptoHrs > 0 && `${weekTotals.ptoHrs.toFixed(1)} PTO`}
              </div>
            )}
            {weekTotals.mealPremiumHrs > 0 && (
              <div className="text-chip-warn-fg">{weekTotals.mealPremiumHrs.toFixed(0)} meal</div>
            )}
          </>
        ) : (
          <span className="text-lt-fg3">—</span>
        )}
      </td>
    </>
  )
}

function DayCell({
  employeeId, date, cell, editable, firstOfWeek, expanded, onToggle, onPatch,
}: {
  employeeId: string
  date: string
  cell?: GridCell
  editable: boolean
  firstOfWeek: boolean
  expanded: boolean
  onToggle: () => void
  onPatch: Props['onPatch']
}) {
  const [saving, setSaving] = useState(false)

  const patch = useCallback(async (p: CellPatch) => {
    setSaving(true)
    try { await onPatch(employeeId, date, p) } finally { setSaving(false) }
  }, [employeeId, date, onPatch])

  const border = firstOfWeek ? 'border-l-2 border-l-lt-fg3' : 'border-l border-lt-hairline'
  const flag = cell?.incomplete
    ? 'bg-chip-bad-bg/50'
    : cell?.mealPremium || (cell?.adjHrs ?? 0) !== 0
      ? 'bg-chip-warn-bg/40'
      : ''

  return (
    <td className={`align-top p-0 ${border} ${flag} ${saving ? 'opacity-50' : ''}`}>
      <div className="px-1 py-1 space-y-0.5">
        <ClockInput
          value={cell?.inClock ?? ''}
          editable={editable}
          placeholder="in"
          onCommit={(v) => patch({ inClock: v })}
        />
        <ClockInput
          value={cell?.outClock ?? ''}
          editable={editable}
          placeholder="out"
          onCommit={(v) => patch({ outClock: v })}
        />
        <button
          type="button"
          onClick={onToggle}
          className="w-full text-center text-[11px] tabular-nums text-lt-fg2 hover:text-lt-fg rounded px-1 leading-tight"
          title="Lunch, sick, PTO, adjustment, meal premium"
        >
          {cell && cell.workedHrs > 0 ? (
            <span className="font-medium text-lt-fg">{hrs(cell.workedHrs)}</span>
          ) : cell && (cell.sickHrs > 0 || cell.ptoHrs > 0) ? (
            <span className="text-lt-fg3">{cell.sickHrs > 0 ? 'sick' : 'PTO'}</span>
          ) : (
            <span className="text-lt-fg3">·</span>
          )}
        </button>
      </div>
      {expanded && (
        <CellDetail cell={cell} editable={editable} onPatch={patch} onClose={onToggle} />
      )}
    </td>
  )
}

/**
 * A clock box. Commits on blur and on Enter, not on every keystroke — this is
 * a live DB write per cell and a request per character would be absurd.
 */
function ClockInput({
  value, editable, placeholder, onCommit,
}: {
  value: string
  editable: boolean
  placeholder: string
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  // While not focused, follow the server. The grid re-renders after every save.
  const shown = focused ? draft : value

  if (!editable) {
    return (
      <div className="w-full text-center text-[11px] tabular-nums text-lt-fg2 py-0.5">
        {value || <span className="text-lt-fg3">–</span>}
      </div>
    )
  }

  return (
    <input
      value={shown}
      placeholder={placeholder}
      inputMode="numeric"
      onFocus={() => { setDraft(value); setFocused(true) }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setDraft(value); (e.target as HTMLInputElement).blur() }
      }}
      className="w-full rounded border border-transparent hover:border-lt-hairline focus:border-lt-fg focus:outline-none bg-transparent text-center text-[11px] tabular-nums text-lt-fg py-0.5 placeholder:text-lt-fg3"
    />
  )
}

/** The uncommon fields, one click away so the grid stays readable. */
function CellDetail({
  cell, editable, onPatch, onClose,
}: {
  cell?: GridCell
  editable: boolean
  onPatch: (p: CellPatch) => Promise<void>
  onClose: () => void
}) {
  return (
    <div className="border-t border-lt-hairline bg-lt-inner px-2 py-2 space-y-1.5 text-[11px] w-[210px]">
      <NumField label="Lunch (min)" value={cell?.lunchMin ?? 30} editable={editable}
        onCommit={(n) => onPatch({ lunchMin: n })} />
      <NumField label="Sick hrs" value={cell?.sickHrs ?? 0} editable={editable}
        onCommit={(n) => onPatch({ sickHrs: n })} />
      <NumField label="PTO hrs" value={cell?.ptoHrs ?? 0} editable={editable}
        onCommit={(n) => onPatch({ ptoHrs: n })} />
      <NumField label="Adjustment" value={cell?.adjHrs ?? 0} editable={editable}
        onCommit={(n) => onPatch({ adjHrs: n })} />
      <label className="flex items-center gap-2 text-lt-fg2">
        <input
          type="checkbox"
          disabled={!editable}
          checked={cell?.mealPremium ?? false}
          onChange={(e) => onPatch({ mealPremium: e.target.checked })}
        />
        Meal premium (1 hr pay)
      </label>
      {editable && cell && (
        <button
          onClick={() => { void onPatch({ clear: true }); onClose() }}
          className="text-chip-bad-fg hover:underline"
        >
          Clear this day
        </button>
      )}
    </div>
  )
}

function NumField({
  label, value, editable, onCommit,
}: {
  label: string
  value: number
  editable: boolean
  onCommit: (n: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const [focused, setFocused] = useState(false)
  return (
    <label className="flex items-center justify-between gap-2 text-lt-fg2">
      {label}
      <input
        value={focused ? draft : String(value)}
        disabled={!editable}
        inputMode="decimal"
        onFocus={() => { setDraft(String(value)); setFocused(true) }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setFocused(false)
          const n = Number(draft)
          if (Number.isFinite(n) && n !== value) onCommit(n)
        }}
        className="w-16 rounded border border-lt-hairline bg-lt-card text-center tabular-nums text-lt-fg py-0.5"
      />
    </label>
  )
}

function TotalsRow({ grid }: { grid: PeriodGrid }) {
  const span = grid.weeks.reduce((s, w) => s + w.days.length + 1, 0)
  return (
    <tr className="bg-lt-inner border-t-2 border-lt-fg3">
      <th className="sticky left-0 z-10 bg-lt-inner text-left px-3 py-2.5 border-r border-lt-hairline text-sm font-semibold text-lt-fg">
        Period total
      </th>
      <td colSpan={span} className="px-3 py-2.5">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums">
          <Total label="Regular" value={grid.totals.regHrs} />
          <Total label="OT" value={grid.totals.otHrs} warn />
          <Total label="Double time" value={grid.totals.dtHrs} bad />
          <Total label="Sick" value={grid.totals.sickHrs} />
          <Total label="PTO" value={grid.totals.ptoHrs} />
          <Total label="Meal premium" value={grid.totals.mealPremiumHrs} warn />
        </div>
      </td>
    </tr>
  )
}

function Total({ label, value, warn, bad }: { label: string; value: number; warn?: boolean; bad?: boolean }) {
  const tone = value > 0 && bad ? 'text-chip-bad-fg' : value > 0 && warn ? 'text-chip-warn-fg' : 'text-lt-fg'
  return (
    <span className="text-lt-fg2">
      {label} <span className={`font-semibold ${tone}`}>{value.toFixed(2)}</span>
    </span>
  )
}

/**
 * Mobile. One person per card, only the days that have something on them —
 * fourteen empty rows per employee on a phone is scrolling, not information.
 */
function MobileEmployeeCard({
  row, grid, onPatch,
}: {
  row: GridRow
  grid: PeriodGrid
  onPatch: Props['onPatch']
}) {
  const [open, setOpen] = useState(false)
  const keyed = useMemo(() => grid.days.filter((d) => row.cells[d]), [grid.days, row.cells])

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-lt-fg">{row.fullName}</div>
          <div className="text-xs text-lt-fg2 mt-0.5 tabular-nums">
            {row.totals.regHrs.toFixed(2)} reg
            {row.totals.otHrs > 0 && ` · ${row.totals.otHrs.toFixed(2)} OT`}
            {row.totals.dtHrs > 0 && ` · ${row.totals.dtHrs.toFixed(2)} DT`}
            {keyed.length === 0 && ' · nothing keyed'}
          </div>
        </div>
        <span className="text-lt-fg3 text-xs shrink-0">{open ? 'Hide' : 'Days'}</span>
      </button>

      {open && (
        <div className="border-t border-lt-hairline divide-y divide-lt-hairline">
          {grid.days.map((date) => {
            const cell = row.cells[date]
            const { dow, num } = dayLabel(date)
            return (
              <div key={date} className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-14 shrink-0 text-xs text-lt-fg2">
                  {dow} {num}
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <ClockInput
                    value={cell?.inClock ?? ''}
                    editable={grid.editable}
                    placeholder="in"
                    onCommit={(v) => onPatch(row.employeeId, date, { inClock: v })}
                  />
                  <span className="text-lt-fg3 text-xs">–</span>
                  <ClockInput
                    value={cell?.outClock ?? ''}
                    editable={grid.editable}
                    placeholder="out"
                    onCommit={(v) => onPatch(row.employeeId, date, { outClock: v })}
                  />
                </div>
                <div className="w-12 shrink-0 text-right text-xs tabular-nums text-lt-fg font-medium">
                  {cell ? hrs(cell.workedHrs) : ''}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
