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
