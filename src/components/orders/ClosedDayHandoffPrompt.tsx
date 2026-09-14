'use client'

/**
 * The out-of-hours handoff question, asked wherever a rental window is
 * picked: the reservation desk and the order builder.
 *
 * Wes 2026-09-13: "We are closed on sundays, so all pickups and returns
 * on that day should be asked: Is this a blind pickup/dropoff?" — and
 * 2026-09-14: "Also ask on Saturday after 3:30."
 *
 * A Sunday is asked straight: blind, or somebody opens up. A Saturday is
 * asked in the other order, because the yard IS staffed until 3:30 PM and
 * no order carries a pickup time — so the first answer is what time it
 * is, and "before 3:30" closes the question without setting anything.
 *
 * The rules — when the yard is shut, what is still unanswered, and what
 * the answers set on the order — are lib/orders/closedDayHandoff, and
 * are re-exported here so a surface takes the prompt and its blocker
 * from one import.
 */

import { calendarDayLabel, calendarDayOf, YARD_HOURS_ONE_LINE, type YardClosure } from '@/lib/site/yardHours'
import {
  answerStands,
  closedDayAsks,
  closedDayBlockers,
  type ClosedDayAnswer,
  type ClosedDayAnswerRecord,
  type ClosedDayHandoff,
} from '@/lib/orders/closedDayHandoff'

export {
  NO_CLOSED_DAY_ANSWERS,
  answerStands,
  closedDayAsks,
  closedDayBlockers,
  blindFlagsFor,
  pruneClosedDayAnswers,
} from '@/lib/orders/closedDayHandoff'
export type {
  ClosedDayAnswer,
  ClosedDayAnswerRecord,
  ClosedDayHandoff,
} from '@/lib/orders/closedDayHandoff'

function Choice({
  label,
  selected,
  onPick,
}: {
  label: string
  selected: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`px-2.5 py-1.5 rounded-md border text-[12px] font-semibold ${
        selected
          ? 'bg-amber-600 border-amber-600 text-white'
          : 'bg-lt-card border-lt-hairline text-lt-fg hover:border-amber-600'
      }`}
    >
      {label}
    </button>
  )
}

/** The answers on offer, in the order the desk thinks about them. A
 *  Saturday is asked what TIME it is first — that is the fact that
 *  decides whether there is a question at all. */
function choicesFor(closure: YardClosure, side: 'pickup' | 'dropoff'): Array<{ value: ClosedDayAnswer; label: string }> {
  const theyTakeIt = side === 'pickup' ? 'they let themselves in' : 'they leave it'
  if (closure.kind === 'CLOSED_ALL_DAY') {
    return [
      { value: 'BLIND', label: `Blind — ${theyTakeIt}` },
      { value: 'STAFFED', label: 'No — we meet them' },
    ]
  }
  return [
    { value: 'IN_HOURS', label: `Before ${closure.closesAt} — we're open` },
    { value: 'BLIND', label: `After ${closure.closesAt} — blind` },
    { value: 'STAFFED', label: `After ${closure.closesAt} — we meet them` },
  ]
}

function questionFor(closure: YardClosure, side: 'pickup' | 'dropoff'): string {
  const noun = side === 'pickup' ? 'pickup' : 'drop-off'
  return closure.kind === 'CLOSED_ALL_DAY'
    ? `Is this a blind ${noun}?`
    : `What time is this ${noun}?`
}

function Ask({
  closure,
  side,
  day,
  value,
  onChange,
}: {
  closure: YardClosure
  side: 'pickup' | 'dropoff'
  /** The calendar day being asked about — carried into the answer so it
   *  cannot outlive the date it was given for. */
  day: string | null | undefined
  value: ClosedDayAnswerRecord | null
  onChange: (v: ClosedDayAnswerRecord) => void
}) {
  const answered = answerStands(day, closure, value)
  const dayLabel = calendarDayLabel(day)
  const picked = answered ? value?.answer : null
  return (
    <div className="space-y-1.5">
      <div className={`text-[12px] font-semibold ${answered ? 'text-lt-fg' : 'text-chip-warn-fg'}`}>
        {questionFor(closure, side)}
        {dayLabel ? <span className="font-normal"> — {dayLabel}</span> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {choicesFor(closure, side).map((c) => (
          <Choice
            key={c.value}
            label={c.label}
            selected={picked === c.value}
            onPick={() => onChange({ day: calendarDayOf(day) ?? '', answer: c.value })}
          />
        ))}
      </div>
      {picked === 'STAFFED' && (
        <p className="text-[11px] text-lt-fg3">
          Someone has to open the yard for it. Tell whoever is covering — nobody is scheduled.
        </p>
      )}
    </div>
  )
}

/** The card's own heading. Names the closure the desk is looking at, and
 *  goes generic rather than wrong when the window spans both. */
function headingFor(asks: { pickup: YardClosure | null; dropoff: YardClosure | null }): string {
  const kinds = new Set([asks.pickup?.kind, asks.dropoff?.kind].filter(Boolean))
  if (kinds.size > 1) return 'Outside yard hours'
  const only = asks.pickup ?? asks.dropoff
  if (!only) return 'Outside yard hours'
  return only.kind === 'CLOSED_ALL_DAY'
    ? "We're closed Sunday"
    : `Saturday we close at ${only.closesAt}`
}

/**
 * Renders nothing at all when neither end of the window touches a
 * closure, so it is safe to drop under any date pair.
 */
export function ClosedDayHandoffPrompt({
  start,
  end,
  value,
  onChange,
}: {
  start: string | null | undefined
  end: string | null | undefined
  value: ClosedDayHandoff
  onChange: (v: ClosedDayHandoff) => void
}) {
  const asks = closedDayAsks(start, end)
  if (!asks.pickup && !asks.dropoff) return null
  const answered = closedDayBlockers(start, end, value).length === 0

  return (
    <div
      className={`rounded-lg border p-3 space-y-3 ${
        answered ? 'border-lt-hairline bg-lt-inner/40' : 'border-chip-warn-fg/40 bg-chip-warn-bg'
      }`}
    >
      <div>
        <div className={`text-xs font-semibold ${answered ? 'text-lt-fg' : 'text-chip-warn-fg'}`}>
          {headingFor(asks)}
          {!answered && <span className="font-normal"> — answer before this is saved.</span>}
        </div>
        <div className="text-[11px] text-lt-fg3 mt-0.5">{YARD_HOURS_ONE_LINE}</div>
      </div>

      {asks.pickup && (
        <Ask
          closure={asks.pickup}
          side="pickup"
          day={start}
          value={value.pickup}
          onChange={(v) => onChange({ ...value, pickup: v })}
        />
      )}

      {asks.dropoff && (
        <Ask
          closure={asks.dropoff}
          side="dropoff"
          day={end}
          value={value.dropoff}
          onChange={(v) => onChange({ ...value, dropoff: v })}
        />
      )}

      <p className="text-[11px] text-lt-fg3">
        Blind turns on the order&apos;s blind-handoff flag: the client gets staging and code
        instructions on their portal, and a blind return lights the check-in alert on Fleet Dispatch
        so the unit doesn&apos;t sit in the lot unprocessed. Write the instructions on the order.
      </p>
    </div>
  )
}
