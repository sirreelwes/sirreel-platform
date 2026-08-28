'use client'

/**
 * Segment chips for the People tab, plus saved segments.
 *
 * Mirrors the Companies-tab chip strip: server-driven, population
 * counts, re-tap to clear. The saved-segment row underneath is the new
 * part — a named filter set you click instead of rebuilding.
 *
 * A chip with a count of zero still renders, greyed and disabled. The
 * Companies strip hides zero-count chips to stay scannable, but these
 * are a fixed set of seven and hiding one changes the shape of the strip
 * you learned; a visible zero also answers "is this broken or is it
 * genuinely empty" without a click.
 */

import {
  PEOPLE_SEGMENT_KEYS,
  PEOPLE_SEGMENTS,
  type PeopleSegmentCounts,
  type PeopleSegmentKey,
} from '@/lib/crm/peopleSegments'

export interface SavedSegment {
  id: string
  name: string
  segmentKey: string | null
  roleKey: string | null
  search: string | null
  createdBy: { id: string; name: string | null; email: string }
}

export function PeopleSegmentChips({
  active,
  counts,
  onPick,
  saved,
  activeSavedId,
  onPickSaved,
  onDeleteSaved,
  canSave,
  onSave,
  viewerEmail,
}: {
  active: PeopleSegmentKey | null
  counts: PeopleSegmentCounts | null
  onPick: (next: PeopleSegmentKey) => void
  saved: SavedSegment[]
  activeSavedId: string | null
  onPickSaved: (s: SavedSegment) => void
  onDeleteSaved: (s: SavedSegment) => void
  canSave: boolean
  onSave: () => void
  /** Compared against createdBy.email — the client session carries an
   *  email, not a User.id, and only the creator may delete a segment. */
  viewerEmail: string | null
}) {
  const chipBase =
    'text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1.5'

  return (
    <div className="mb-3 space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => active && onPick(active)}
          className={`${chipBase} ${
            active === null
              ? 'bg-lt-fg border-lt-fg text-white'
              : 'bg-lt-card border-lt-hairline text-lt-fg2 hover:border-lt-fg2'
          }`}
          title="Show every contact"
        >
          All
        </button>

        {PEOPLE_SEGMENT_KEYS.map((key) => {
          const meta = PEOPLE_SEGMENTS[key]
          const count = counts?.[key] ?? 0
          const isActive = active === key
          const empty = counts !== null && count === 0
          return (
            <button
              key={key}
              type="button"
              disabled={empty && !isActive}
              onClick={() => onPick(key)}
              title={empty ? meta.emptyMessage : meta.description}
              className={`${chipBase} ${
                isActive
                  ? 'bg-lt-fg border-lt-fg text-white'
                  : empty
                    ? 'bg-lt-card border-lt-hairline text-lt-fg3 opacity-50 cursor-default'
                    : 'bg-lt-card border-lt-hairline text-lt-fg2 hover:border-lt-fg2'
              }`}
            >
              <span>{meta.label}</span>
              <span className={`font-mono ${isActive ? 'text-white' : 'text-lt-fg3'}`}>
                {counts === null ? '·' : count}
              </span>
            </button>
          )
        })}

        {canSave && (
          <button
            type="button"
            onClick={onSave}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-dashed border-lt-fg3 text-lt-fg2 hover:border-lt-fg2 hover:text-lt-fg transition-colors"
            title="Save the current filters as a named segment you can click next time"
          >
            + Save this segment
          </button>
        )}
      </div>

      {saved.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-lt-fg3 mr-1">Saved</span>
          {saved.map((s) => {
            const isActive = activeSavedId === s.id
            const mine =
              viewerEmail !== null &&
              s.createdBy.email.toLowerCase() === viewerEmail.toLowerCase()
            return (
              <span
                key={s.id}
                className={`${chipBase} ${
                  isActive
                    ? 'bg-amber-600 border-amber-600 text-white'
                    : 'bg-lt-card border-lt-hairline text-lt-fg2 hover:border-lt-fg2'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onPickSaved(s)}
                  title={`${describeSaved(s)}${mine ? '' : ` · saved by ${s.createdBy.name || s.createdBy.email}`}`}
                  className="font-semibold"
                >
                  {s.name}
                </button>
                {mine && (
                  <button
                    type="button"
                    onClick={() => onDeleteSaved(s)}
                    aria-label={`Delete saved segment ${s.name}`}
                    title="Delete this saved segment"
                    className={`leading-none ${isActive ? 'text-white/70 hover:text-white' : 'text-lt-fg3 hover:text-chip-bad-fg'}`}
                  >
                    ×
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Human-readable summary of what a saved segment actually filters on. */
export function describeSaved(s: SavedSegment): string {
  const parts: string[] = []
  if (s.segmentKey && s.segmentKey in PEOPLE_SEGMENTS) {
    parts.push(PEOPLE_SEGMENTS[s.segmentKey as PeopleSegmentKey].label)
  }
  if (s.roleKey) parts.push(s.roleKey.replace(/_/g, ' ').toLowerCase())
  if (s.search) parts.push(`matching “${s.search}”`)
  return parts.length > 0 ? parts.join(' · ') : 'No filters'
}
