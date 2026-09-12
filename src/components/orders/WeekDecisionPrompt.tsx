'use client'

/**
 * "Which billing week?" — the question the quote builder now asks before
 * the paper leaves.
 *
 * Wes 2026-09-11: "If a 3d 2d or 1d week isn't selected, it goes out full
 * rate. I feel like we should prompt agents to select rather than risk
 * losing work because our quote comes in so much higher."
 *
 * ── Why a prompt and not a bigger dropdown ─────────────────────────
 *
 * The section select has been there since 2026-08-31 and reads "Week…".
 * It names no money, so an agent has no reason to open it, and the
 * default — the department's standard week — is the most expensive week
 * the system offers. On a rental no longer than that week (a three-day
 * supplies job, any GE job inside a week) the standard week discounts
 * nothing at all: the quote goes out at full rate and the only sign is
 * an untouched select.
 *
 * So the arithmetic comes to the agent instead. Each section shows the
 * week in effect and what the shorter weeks would price it at, in
 * dollars, one click each. Nothing is pre-selected and nothing is
 * changed on their behalf — the standard week is a legitimate answer and
 * "Keep it" is right there. The point is that it becomes an answer
 * someone gave.
 *
 * Asked once per session, on the first action that produces
 * client-facing paper. A second quote for the same order is not a second
 * interrogation.
 *
 * Used from BOTH ends of a quote's life: the builder (/orders/new), where
 * picking a week reprices the rows in memory, and the order detail page,
 * where it writes through /line-items/bulk-days. That second caller is
 * why `busy` and `error` exist — its picks are a round trip that can be
 * refused, and a modal that swallows a refusal is worse than no modal.
 */

import type { LineItemDepartment } from '@prisma/client'
import type { WeekSection } from '@/lib/orders/weekDecision'
import { DEPARTMENT_LABEL } from '@/lib/sales/pipeline'

const usd = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

const signed = (n: number) => (n < 0 ? `−${usd(Math.abs(n))}` : `+${usd(n)}`)

const dayWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`

export function WeekDecisionPrompt({
  sections,
  actionLabel,
  onPick,
  onProceed,
  onCancel,
  busy = null,
  error = null,
}: {
  /** The undecided sections, priced. Recomputed by the caller from live
   *  rows, so picking a week re-renders this list with the new numbers
   *  rather than closing the door on a second look. */
  sections: WeekSection[]
  /** What the agent was doing when we interrupted — "Send quote",
   *  "Preview PDF". The primary button says it back to them. */
  actionLabel: string
  onPick: (department: LineItemDepartment, cap: number) => void
  onProceed: () => void
  onCancel: () => void
  /** A section whose pick is in flight — its buttons go quiet until the
   *  write lands and the numbers come back from the server. */
  busy?: LineItemDepartment | null
  /** Why the last pick did not take. Shown where it was clicked, not in
   *  an alert the agent dismisses on the way to sending anyway. */
  error?: string | null
}) {
  const exposure = sections.reduce(
    (sum, s) => sum + Math.min(0, ...s.options.map((o) => o.delta)),
    0,
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-2xl rounded-xl border border-lt-hairline bg-lt-card shadow-xl">
        <header className="border-b border-lt-hairline px-5 py-4">
          <h2 className="text-lg font-bold text-lt-fg">Which billing week?</h2>
          <p className="mt-1 text-xs leading-relaxed text-lt-fg2">
            {sections.length === 1 ? 'This section is' : 'These sections are'} priced at the
            standard week — the most this quote can come to. A shorter week bills fewer days
            from the same dates.
            {exposure < 0 && (
              <>
                {' '}
                <span className="font-semibold text-lt-fg">
                  Up to {usd(Math.abs(exposure))} of room
                </span>{' '}
                if you want it.
              </>
            )}
          </p>
        </header>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto px-5 py-4">
          {sections.map((s) => (
            <section key={s.department} className="rounded-lg border border-lt-hairline bg-lt-inner p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-bold uppercase tracking-wider text-lt-fg">
                  {DEPARTMENT_LABEL[s.department]}
                </div>
                <div className="text-xs text-lt-fg2">
                  {dayWord(s.calendarDays)} on the calendar · billing{' '}
                  <span className="font-semibold text-lt-fg">{dayWord(s.currentDays)}</span> ·{' '}
                  <span className="font-mono font-semibold text-lt-fg">{usd(s.currentTotal)}</span>
                </div>
              </div>

              {s.skippedCount > 0 && (
                <p className="mt-1 text-[11px] text-lt-fg3">
                  {s.skippedCount} line{s.skippedCount === 1 ? '' : 's'} not priced by a week
                  (dates TBD, or billed per day) — left alone.
                </p>
              )}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.options.map((o) => (
                  <button
                    key={o.cap}
                    type="button"
                    disabled={busy != null}
                    onClick={() => onPick(s.department, o.cap)}
                    title={`Bill ${o.cap} day${o.cap === 1 ? '' : 's'} per 7-day week — ${dayWord(
                      o.days,
                    )} across this section`}
                    className={`rounded-md border px-2.5 py-1.5 text-left text-[11px] font-semibold transition disabled:opacity-50 ${
                      o.isCurrent
                        ? 'border-amber-600 bg-amber-600 text-white'
                        : 'border-lt-hairline bg-lt-card text-lt-fg2 hover:border-lt-fg3 hover:text-lt-fg'
                    }`}
                  >
                    <span className="block">
                      {o.cap}-day wk{o.isStandard ? ' (std)' : ''}
                    </span>
                    <span
                      className={`mt-0.5 block font-mono text-[10px] font-normal ${
                        o.isCurrent ? 'text-white/80' : 'text-lt-fg3'
                      }`}
                    >
                      {usd(o.total)}
                      {o.delta !== 0 && ` · ${signed(o.delta)}`}
                      {o.isCurrent && ' · now'}
                    </span>
                  </button>
                ))}
                {busy === s.department && (
                  <span className="self-center text-[11px] text-lt-fg3">Applying…</span>
                )}
              </div>
            </section>
          ))}
          {error && (
            <p className="rounded-lg bg-chip-bad-bg px-3 py-2 text-[11px] font-medium text-chip-bad-fg">
              {error}
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-lt-hairline px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 text-sm text-lt-fg2 hover:text-lt-fg"
          >
            Back to the quote
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-lt-fg3 sm:inline">
              The standard week is a real answer.
            </span>
            <button
              type="button"
              onClick={onProceed}
              disabled={busy != null}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {actionLabel} →
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
