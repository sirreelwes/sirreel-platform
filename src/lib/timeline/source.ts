/**
 * Tiny source-flag helper used by gantt / dashboard / calendar pages
 * to opt into the native Timeline endpoint via `?source=native` on
 * the URL. Defaults to `planyo` so today's behavior is unchanged.
 *
 * When convergence is verified on /timeline-shadow, flip the default
 * here to 'native' (one-line change). Chunk 8 then retires the
 * Planyo endpoint entirely.
 */

export type TimelineSource = 'planyo' | 'native'

export function resolveTimelineSource(params: URLSearchParams | { get(name: string): string | null }): TimelineSource {
  return params.get('source') === 'native' ? 'native' : 'planyo'
}

export function timelineEndpoint(source: TimelineSource): string {
  return source === 'native' ? '/api/timeline-native' : '/api/timeline'
}
