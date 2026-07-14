/**
 * First-name derivation for client-facing email copy ("Wes has finalized
 * your terms…", "this reaches Jose directly"). First whitespace token of
 * the display name; null when nothing usable — callers fall back to
 * "your SirReel agent" (or equivalent) so copy degrades gracefully.
 */
export function firstNameOf(fullName?: string | null): string | null {
  const first = (fullName || '').trim().split(/\s+/)[0]
  return first || null
}
