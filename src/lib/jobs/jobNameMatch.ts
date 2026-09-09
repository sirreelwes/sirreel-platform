/**
 * Is this Planyo booking's job name the SAME production as this HQ job?
 *
 * Pulled out of resolveJob (rung ⑤) so it can be tested without a
 * database — same reason jobDisambiguation.ts is Prisma-free.
 *
 * Origin (2026-09-09): Darsh's self-serve job "WS" and Jose's Planyo cart
 * "WS-RK" were the same Chaotic Neutral shoot, and the importer built a
 * second job (SR-JOB-0328) beside the first. The name rung should have
 * caught it — the old loose key test, `'wsrk'.includes('ws')`, is true —
 * but two things stopped it, and both are fixed here:
 *
 *   1. The old rule gated only on the length of the INCOMING name, so a
 *      2-character existing job name was a substring of half the catalog:
 *      an incoming "Newsroom" name-matched an open job called "WS", at
 *      full rung score. The gate now applies to the SHORTER side, which is
 *      the one that has to carry the evidence.
 *   2. Short names then had no way to match at all, so containment alone
 *      would have thrown "WS" vs "WS-RK" away with the false positives.
 *      Token-prefix rescues exactly that shape — the incoming name is the
 *      job's name plus a suffix — without re-admitting "Newsroom".
 *
 * The rule the Echobend case (Wes, Jul 14) demands is preserved: four
 * different shoots for one client in one week, named "Echobend A/B/C/D",
 * must NOT read as the same job. They differ in the last token, so
 * neither containment nor token-prefix fires.
 */

/** Lowercase alphanumerics only — "WS-RK" → "wsrk". */
export function looseKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Word-ish pieces — "WS-RK" → ["ws", "rk"]. */
export function nameTokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/**
 * Shortest substring that may stand alone as evidence. Below this, a
 * containment hit is noise ("ws" inside "newsroom"); at or above it the
 * shared run of characters is doing real work ("kitkat").
 */
const MIN_CONTAINMENT = 4

/**
 * True when two job names plausibly name the SAME production.
 *
 * Deliberately not a similarity score: the caller (resolveJob rung ⑤)
 * turns this into an attach ANCHOR, and an anchor is a yes/no claim.
 * Three ways to earn it:
 *   - identical once punctuation and case are dropped ("Kit Kat" / "KitKat")
 *   - one name contains the other, shorter side ≥ 4 chars ("Hills" / "The Hills")
 *   - one name's tokens are a prefix of the other's ("WS" / "WS-RK")
 */
export function jobNamesRelated(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = looseKey(a ?? '')
  const kb = looseKey(b ?? '')
  if (!ka || !kb) return false
  if (ka === kb) return true

  const [shortKey, longKey] = ka.length <= kb.length ? [ka, kb] : [kb, ka]
  if (shortKey.length >= MIN_CONTAINMENT && longKey.includes(shortKey)) return true

  const ta = nameTokens(a ?? '')
  const tb = nameTokens(b ?? '')
  const [shortTokens, longTokens] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (!shortTokens.length) return false
  return shortTokens.every((t, i) => longTokens[i] === t)
}
