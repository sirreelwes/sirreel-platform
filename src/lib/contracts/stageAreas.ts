/**
 * SirReel bookable stage areas — SINGLE SOURCE for the stage-terms tool
 * checkboxes and everywhere selected areas render (v2 studio card,
 * signed-copy PDF, ready-to-sign flows).
 *
 * ⚠️ PROVISIONAL LABELS (July 2026): Wes's verbatim list didn't survive
 * the goal handoff (placeholder text). These four match the real
 * bookable Lankershim Studios assets in the native scheduler
 * (scripts/scheduling-add-missing-assets.ts). To finalize: edit ONLY
 * the `label` strings below — keys are stable and stored in
 * stageDetails, so relabeling never touches saved data.
 *
 * Rules encoded here:
 *  - `key` is what's persisted in stageDetails.sets — never rename a
 *    key that has shipped; retire it instead (remove from this list;
 *    stageAreaLabel falls back to rendering the stored label/key).
 *  - STRYKER_TRIGGER_KEY: the Hospital Set is the ONLY area that pulls
 *    the Stryker Master Media Use Agreement.
 */

export interface StageArea {
  key: string
  label: string
}

export const STAGE_AREAS: StageArea[] = [
  { key: 'hospital', label: 'Hospital Set' },
  { key: 'police', label: 'Police Set' },
  { key: 'led', label: 'LED Stage' },
  { key: 'blackbox', label: 'Black Box' },
]

/** The one — and only — area key that requires the Stryker MMA. */
export const STRYKER_TRIGGER_KEY = 'hospital'

const LABELS: Record<string, string> = Object.fromEntries(STAGE_AREAS.map((a) => [a.key, a.label]))

/**
 * Retired keys from earlier iterations of this list, kept ONLY so
 * pre-existing saved jobs render a human label instead of a raw key.
 * Never shown as selectable options.
 */
const RETIRED_LABELS: Record<string, string> = {
  morgue: 'Morgue / Laboratory',
}

/**
 * Display label for a stored area key. Current list wins; retired keys
 * render their historical label; anything else renders as-is so an
 * unknown key never breaks a contract render.
 */
export function stageAreaLabel(key: string): string {
  return LABELS[key] || RETIRED_LABELS[key] || key
}

export function isRetiredAreaKey(key: string): boolean {
  return !LABELS[key]
}

export const STAGE_AREA_KEYS = STAGE_AREAS.map((a) => a.key)

// ─── Complex areas ──────────────────────────────────────────────────
// Shared complex amenities (NOT the rented stage, NOT priced — the job
// has a single overall price set elsewhere). Each toggles included /
// not-included per job and only INCLUDED ones render on the studio
// contract. Standard list defaults to included; agents can toggle any
// off or add custom areas (name + toggle, no fee).

export interface ComplexArea {
  key: string
  label: string
  included: boolean
  /** True for agent-added areas (not part of the standing list). */
  custom?: boolean
}

export const STANDARD_COMPLEX_AREAS: { key: string; label: string }[] = [
  { key: 'conference-room', label: 'Conference Room' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'green-room-1', label: 'Green Room 1' },
  { key: 'green-room-2', label: 'Green Room 2' },
  { key: 'parking-gates-4-5', label: 'Parking (Gates 4 & 5)' },
]

/** Fresh default state: every standard amenity included. */
export function defaultComplexAreas(): ComplexArea[] {
  return STANDARD_COMPLEX_AREAS.map((a) => ({ ...a, included: true }))
}

/**
 * Normalize a stored/submitted complexAreas value: seed missing standard
 * entries (default included), keep saved toggles, keep custom entries.
 * Tolerates null/garbage — always returns a well-formed list.
 */
export function normalizeComplexAreas(raw: unknown): ComplexArea[] {
  const saved: ComplexArea[] = Array.isArray(raw)
    ? (raw as any[])
        .filter((a) => a && typeof a.label === 'string' && a.label.trim())
        .map((a) => ({
          key: typeof a.key === 'string' && a.key ? a.key.slice(0, 80) : `custom-${a.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`,
          label: a.label.trim().slice(0, 100),
          included: !!a.included,
          custom: !!a.custom,
        }))
        .slice(0, 40)
    : []
  const byKey = new Map(saved.map((a) => [a.key, a]))
  const standard = STANDARD_COMPLEX_AREAS.map(
    (s) => byKey.get(s.key) ?? { ...s, included: true },
  )
  const customs = saved.filter((a) => !STANDARD_COMPLEX_AREAS.some((s) => s.key === a.key))
  return [...standard, ...customs.map((c) => ({ ...c, custom: true }))]
}

/** Included-only labels, in display order — what the contract shows. */
export function includedComplexAreaLabels(raw: unknown): string[] {
  return normalizeComplexAreas(raw)
    .filter((a) => a.included)
    .map((a) => a.label)
}
