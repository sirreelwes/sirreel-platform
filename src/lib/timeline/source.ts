/**
 * Source-flag helper used by gantt / dashboard / calendar pages.
 * Native scheduling is the live operational source as of the
 * Chunk 8 PR1 cutover (2026-05-23). Planyo remains as a read-only
 * reference view, accessible via `?source=planyo`.
 *
 * PR2 (24–48h post-cutover, once native is stable) will retire
 * /api/timeline and the reference path entirely.
 */

export type TimelineSource = 'planyo' | 'native'

export function resolveTimelineSource(params: URLSearchParams | { get(name: string): string | null }): TimelineSource {
  // Native is the default operational source. `?source=planyo` keeps
  // the legacy Planyo view available as reference until PR2 retires it.
  return params.get('source') === 'planyo' ? 'planyo' : 'native'
}

export function timelineEndpoint(source: TimelineSource): string {
  return source === 'native' ? '/api/timeline-native' : '/api/timeline'
}
