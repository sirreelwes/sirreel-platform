'use client'

/**
 * The closed-day handoff question, asked wherever a rental window is
 * picked: the reservation desk and the order builder.
 *
 * Wes 2026-09-13: "We are closed on sundays, so all pickups and returns
 * on that day should be asked: Is this a blind pickup/dropoff?"
 *
 * The rules — which days are closed, what is still unanswered, and what
 * the answers set on the order — are lib/orders/closedDayHandoff, and
 * are re-exported here so a surface takes the prompt and its blocker
 * from one import.
 */

import { calendarDayLabel, YARD_HOURS_ONE_LINE } from '@/lib/site/yardHours'
import {
  closedDayAsks,
  closedDayBlockers,
  type ClosedDayAnswer,
  type ClosedDayHandoff,
} from '@/lib/orders/closedDayHandoff'

export {
  NO_CLOSED_DAY_ANSWERS,
  closedDayAsks,
  closedDayBlockers,
  blindFlagsFor,
  pruneClosedDayAnswers,
} from '@/lib/orders/closedDayHandoff'
export type { ClosedDayAnswer, ClosedDayHandoff } from '@/lib/orders/closedDayHandoff'

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

function Ask({
  question,
  dayLabel,
  blindLabel,
  staffedLabel,
  answered,
  value,
  onChange,
}: {
  question: string
  dayLabel: string | null
  blindLabel: string
  staffedLabel: string
  answered: boolean
  value: ClosedDayAnswer | null
  onChange: (v: ClosedDayAnswer) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className={`text-[12px] font-semibold ${answered ? 'text-lt-fg' : 'text-chip-warn-fg'}`}>
        {question}
        {dayLabel ? <span className="font-normal"> — {dayLabel}</span> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Choice label={blindLabel} selected={value === 'BLIND'} onPick={() => onChange('BLIND')} />
        <Choice label={staffedLabel} selected={value === 'STAFFED'} onPick={() => onChange('STAFFED')} />
      </div>
      {value === 'STAFFED' && (
        <p className="text-[11px] text-lt-fg3">
          Someone has to open the yard for it. Tell whoever is covering — nobody is scheduled.
        </p>
      )}
    </div>
  )
}

/**
 * Renders nothing at all when neither end of the window is a closed day,
 * so it is safe to drop under any date pair.
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
          We&apos;re closed Sunday
          {!answered && <span className="font-normal"> — answer before this is saved.</span>}
        </div>
        <div className="text-[11px] text-lt-fg3 mt-0.5">{YARD_HOURS_ONE_LINE}</div>
      </div>

      {asks.pickup && (
        <Ask
          question="Is this a blind pickup?"
          dayLabel={calendarDayLabel(start)}
          blindLabel="Blind — they let themselves in"
          staffedLabel="No — we meet them"
          answered={!!value.pickup}
          value={value.pickup}
          onChange={(v) => onChange({ ...value, pickup: v })}
        />
      )}

      {asks.dropoff && (
        <Ask
          question="Is this a blind drop-off?"
          dayLabel={calendarDayLabel(end)}
          blindLabel="Blind — they leave it"
          staffedLabel="No — we meet them"
          answered={!!value.dropoff}
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
