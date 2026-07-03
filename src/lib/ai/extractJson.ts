/**
 * Shared JSON hardening for Anthropic text responses that are supposed
 * to be a single JSON object. Extracted from the orders/parse-quote fix
 * (July 2026) after the same failure class — fenced/preambled output or
 * max_tokens truncation breaking a naive JSON.parse — showed up across
 * every AI call site.
 *
 * Behavior on a well-formed response is identical to JSON.parse(raw).
 */

export class AiJsonError extends Error {
  /** true when the model hit max_tokens — the JSON is guaranteed broken. */
  readonly truncated: boolean

  constructor(message: string, truncated: boolean) {
    super(message)
    this.name = 'AiJsonError'
    this.truncated = truncated
  }
}

/**
 * Slice from the first "{" to the last "}" — markdown fences, preamble
 * ("Here is the JSON:"), and trailing commentary all fall away. Anything
 * without braces is returned as-is so JSON.parse fails loudly upstream.
 */
export function extractJsonObject(raw: string): string {
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first === -1 || last <= first) return raw.trim()
  return raw.slice(first, last + 1)
}

/**
 * Parse a model response into a JSON object.
 *  - detects max_tokens truncation via stopReason and throws AiJsonError
 *    with .truncated=true (the tail is logged — that's where the cut is)
 *  - tolerates fences/preamble/commentary via extractJsonObject
 *  - on parse failure logs head AND tail under the caller's tag, then
 *    throws AiJsonError with .truncated=false
 *
 * Callers keep their own control flow: wrap in the same try/catch that
 * previously wrapped JSON.parse and map AiJsonError to the existing
 * fallback (check .truncated for a distinct "document too long" path).
 */
export function parseAiJson<T = unknown>(
  raw: string,
  opts: { tag: string; stopReason?: string | null }
): T {
  const { tag, stopReason } = opts
  if (stopReason === 'max_tokens') {
    console.error(`[${tag}] output truncated at max_tokens. Tail: …${raw.slice(-400)}`)
    throw new AiJsonError(`${tag}: model output truncated at max_tokens`, true)
  }
  try {
    return JSON.parse(extractJsonObject(raw)) as T
  } catch {
    console.error(
      `[${tag}] JSON parse failed. len=${raw.length}\nHead: ${raw.slice(0, 500)}\nTail: …${raw.slice(-500)}`
    )
    throw new AiJsonError(`${tag}: response was not valid JSON`, false)
  }
}
