/**
 * CC addresses for the review-and-send modal.
 *
 * Wes 2026-08-25: "I need the option to add cc to these emails."
 *
 * One module so the browser and the route agree on what a CC list IS. The
 * input box gives live feedback with `splitCcInput`; every send route runs
 * `parseCcList` on the body regardless, because a client-side check is a
 * convenience, not a control — the request can say anything.
 *
 * Deliberately strict about what leaves the building: a typo'd CC either
 * bounces or, worse, sends a client's paperwork to a stranger.
 */

/** Anything past this is a mailing list, not a CC — and Resend caps recipients. */
export const MAX_CC = 5

// Intentionally plain: one @, a dotted domain, no spaces, no angle brackets.
// Display-name forms ("Ana <ana@x.com>") are rejected rather than parsed —
// the box asks for addresses, and guessing at half-typed names is how the
// wrong person gets copied.
const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;.]+(?:\.[^\s@<>,;.]+)+$/

function tokenize(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.flatMap((v) => (typeof v === 'string' ? v.split(/[,;]/) : []))
  if (typeof raw === 'string') return raw.split(/[,;\n]/)
  return []
}

/**
 * Split a raw input string into valid + invalid, preserving what the user
 * typed for the invalid ones so the UI can show it back to them.
 */
export function splitCcInput(raw: unknown): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>()
  const valid: string[] = []
  const invalid: string[] = []
  for (const token of tokenize(raw)) {
    const t = token.trim()
    if (!t) continue
    const lower = t.toLowerCase()
    if (!EMAIL_RE.test(lower)) {
      if (!invalid.includes(t)) invalid.push(t)
      continue
    }
    if (seen.has(lower)) continue
    seen.add(lower)
    valid.push(lower)
  }
  return { valid, invalid }
}

/**
 * The server-side reading: valid addresses only, deduped, capped. Anything
 * unparseable is dropped rather than throwing — a bad CC should not cost the
 * rep the email they just wrote.
 */
export function parseCcList(raw: unknown): string[] {
  return splitCcInput(raw).valid.slice(0, MAX_CC)
}

/**
 * Combine automatic CCs (e.g. the other job contacts a quote already copies)
 * with the rep's manually typed ones, minus anyone already in To.
 *
 * Merging rather than replacing matters: send-quote copies every other job
 * contact by default, and a manual CC that quietly dropped them would change
 * who sees a quote without anyone noticing.
 */
export function mergeCc(
  auto: readonly string[] | undefined,
  manual: readonly string[] | undefined,
  toAddresses: readonly string[] = [],
): string[] | undefined {
  const exclude = new Set(toAddresses.map((a) => a.trim().toLowerCase()).filter(Boolean))
  const seen = new Set<string>()
  const out: string[] = []
  for (const addr of [...(auto ?? []), ...(manual ?? [])]) {
    const a = (addr ?? '').trim().toLowerCase()
    if (!a || exclude.has(a) || seen.has(a)) continue
    seen.add(a)
    out.push(a)
  }
  return out.length > 0 ? out : undefined
}
