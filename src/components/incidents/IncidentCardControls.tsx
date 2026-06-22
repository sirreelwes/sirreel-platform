'use client'

/**
 * Phase 3 worklist-edit controls extracted from the Incidents list so
 * the detail page (/incidents/[id]) can render the same affordances.
 *
 * Pure presentational shells over the PATCH /api/incidents/[id] gate
 * — each component takes a `busy` flag + an `onSave`/`onSet` callback
 * the parent wires through to a single shared mutation helper. No
 * fetches happen in here.
 *
 *   - <SeverityControl>   effective chip + "auto" badge + escalate /
 *                         de-escalate + clear-override
 *   - <DriverInline>      click-to-edit driver name
 *   - <NextActionRow>     stored action vs derived suggestion w/ due
 *                         pill (overdue/dueSoon tones)
 *   - <RecoveryStepper>   3-step ladder (Carrier → Renter → Absorb)
 *
 * All four were defined inline in /incidents/page.tsx originally; this
 * module is a verbatim lift so the list-card behavior on prod doesn't
 * change while the detail page picks them up.
 */

import { useEffect, useState } from 'react'

export type DerivedSeverity = 'LITIGATION' | 'ROUTINE'
export type RecoveryPosture =
  | 'carrier_not_started'
  | 'carrier_live'
  | 'billing_renter'
  | 'closed'

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Severity control ──────────────────────────────────────────────

export function SeverityControl({
  effective, stored, busy, onSet,
}: {
  effective: DerivedSeverity
  stored: DerivedSeverity | null
  busy: boolean
  onSet: (next: DerivedSeverity | null) => void | Promise<unknown>
}) {
  const isOverride = stored !== null
  const isLit = effective === 'LITIGATION'
  const baseChip = isLit
    ? 'bg-chip-bad-bg text-chip-bad-fg'
    : 'bg-chip-neutral-bg text-chip-neutral-fg'
  const tooltip = isOverride
    ? `Override: ${stored}. Click to clear and fall back to auto.`
    : `Auto-derived from linked mail. Click to escalate or de-escalate.`
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${baseChip}`}
        title={tooltip}
      >
        {isLit ? '⚠ Litigation' : 'Routine'}
      </span>
      {!isOverride && (
        <span
          className="text-[9px] uppercase tracking-wider text-lt-fg3 font-semibold"
          title="No stored override. Effective severity comes from the heuristic."
        >
          auto
        </span>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onSet(isLit ? 'ROUTINE' : 'LITIGATION')}
        className="text-[10px] text-lt-fg3 hover:text-lt-fg2 disabled:opacity-40"
        title={isLit ? 'De-escalate to Routine' : 'Escalate to Litigation'}
      >
        {isLit ? '↓ routine' : '↑ litigation'}
      </button>
      {isOverride && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onSet(null)}
          className="text-[10px] text-lt-fg3 hover:text-lt-fg2 disabled:opacity-40"
          title="Clear override — fall back to auto"
        >
          × clear
        </button>
      )}
    </span>
  )
}

// ─── Driver inline editor ──────────────────────────────────────────

export function DriverInline({
  value, busy, onSave,
}: {
  value: string | null
  busy: boolean
  onSave: (v: string | null) => void | Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value])
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={busy}
        className={`text-xs disabled:opacity-50 ${value ? 'text-lt-fg' : 'italic text-chip-warn-fg'}`}
        title="Click to edit driver"
      >
        {value ? `driver ${value}` : 'driver unknown'}
      </button>
    )
  }
  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === (value ?? '')) { setEditing(false); return }
    void Promise.resolve(onSave(trimmed || null)).then(() => setEditing(false))
  }
  return (
    <input
      autoFocus
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) }
      }}
      disabled={busy}
      placeholder="driver name"
      className="text-xs bg-transparent border-b border-lt-hairline focus:border-lt-fg outline-none px-1 text-lt-fg w-40"
    />
  )
}

// ─── Next-action row ───────────────────────────────────────────────

export function NextActionRow({
  storedAction, storedDueAt, derivedSuggestion,
  isLitigation, isOverdue, dueSoon, busy, onSave, onClear,
}: {
  storedAction: string | null
  storedDueAt: string | null
  derivedSuggestion: string
  isLitigation: boolean
  isOverdue: boolean
  dueSoon: boolean
  busy: boolean
  onSave: (action: string, dueAt: string | null) => void | Promise<unknown>
  onClear: () => void | Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  const [actionDraft, setActionDraft] = useState(storedAction ?? '')
  const [dueDraft, setDueDraft] = useState(storedDueAt ? storedDueAt.slice(0, 10) : '')
  useEffect(() => {
    setActionDraft(storedAction ?? '')
    setDueDraft(storedDueAt ? storedDueAt.slice(0, 10) : '')
  }, [storedAction, storedDueAt])

  if (editing) {
    return (
      <div className="mb-2 flex items-center gap-2 flex-wrap">
        <input
          type="text"
          autoFocus
          value={actionDraft}
          onChange={(e) => setActionDraft(e.target.value)}
          placeholder="e.g. file LD invoice with carrier"
          className="flex-1 min-w-[200px] text-sm border border-lt-hairline rounded px-2 py-1 text-lt-fg"
        />
        <input
          type="date"
          value={dueDraft}
          onChange={(e) => setDueDraft(e.target.value)}
          className="text-sm border border-lt-hairline rounded px-2 py-1 text-lt-fg"
        />
        <button
          type="button"
          disabled={busy || !actionDraft.trim()}
          onClick={async () => {
            await onSave(actionDraft.trim(), dueDraft || null)
            setEditing(false)
          }}
          className="text-xs font-semibold bg-lt-fg text-white px-2.5 py-1 rounded disabled:opacity-40"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            setActionDraft(storedAction ?? '')
            setDueDraft(storedDueAt ? storedDueAt.slice(0, 10) : '')
            setEditing(false)
          }}
          className="text-xs text-lt-fg3 hover:text-lt-fg2"
        >
          Cancel
        </button>
      </div>
    )
  }

  if (storedAction) {
    const dueTone = isOverdue
      ? 'bg-chip-bad-bg text-chip-bad-fg'
      : dueSoon
        ? 'bg-chip-warn-bg text-chip-warn-fg'
        : 'bg-lt-inner text-lt-fg3'
    return (
      <div className="mb-2 flex items-center gap-2 flex-wrap text-sm">
        <span className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold">Next</span>
        <span className="text-lt-fg font-medium">{storedAction}</span>
        {storedDueAt && (
          <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${dueTone}`}>
            {isOverdue ? 'overdue ' : 'due '}
            {fmtDate(storedDueAt)}
          </span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={busy}
          className="text-[11px] text-lt-fg3 hover:text-lt-fg2 disabled:opacity-40"
        >
          edit
        </button>
        <button
          type="button"
          onClick={() => onClear()}
          disabled={busy}
          className="text-[11px] text-lt-fg3 hover:text-chip-bad-fg disabled:opacity-40"
        >
          clear
        </button>
      </div>
    )
  }

  return (
    <div className={`mb-2 flex items-center gap-2 flex-wrap text-sm ${isLitigation ? 'text-chip-bad-fg font-medium' : 'text-lt-fg2'}`}>
      <span className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold">Suggested</span>
      <span>{derivedSuggestion}</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={busy}
        className="text-[11px] text-lt-fg3 hover:text-lt-fg2 disabled:opacity-40"
      >
        set action…
      </button>
    </div>
  )
}

// ─── Recovery stepper ──────────────────────────────────────────────

export function RecoveryStepper({
  posture, className,
}: {
  posture: RecoveryPosture
  className?: string
}) {
  const steps = ['Carrier claim', 'Bill renter', 'Absorb'] as const
  const currentIndex = posture === 'carrier_not_started' ? -1
    : posture === 'carrier_live' ? 0
    : posture === 'billing_renter' ? 1
    : 2
  const closed = posture === 'closed'
  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
      {steps.map((label, i) => {
        const isCurrent = !closed && i === currentIndex
        const isDone = !closed && i < currentIndex
        const cls = closed
          ? 'bg-lt-inner border-lt-hairline text-lt-fg3'
          : isCurrent
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-700 font-semibold'
            : isDone
              ? 'bg-chip-good-bg border-chip-good-fg/30 text-chip-good-fg'
              : 'bg-transparent border-lt-hairline text-lt-fg3'
        return (
          <span key={label} className="flex items-center gap-1">
            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${cls}`}>
              {isDone && <span className="mr-1" aria-hidden>✓</span>}
              {label}
            </span>
            {i < steps.length - 1 && (
              <span className="text-lt-fg3 text-xs" aria-hidden>→</span>
            )}
          </span>
        )
      })}
    </div>
  )
}
