/**
 * US phone-number formatting helpers.
 *
 * One canonical implementation, used everywhere a user types or pastes
 * a phone number into the platform. Previously each input form re-rolled
 * its own chained .replace() and they drifted apart — the
 * "(760) 672-(552" bug in the Create & Send Portal Link modal came from
 * a regex that incorrectly inserted an opening paren after the dash at
 * position 9. This util fixes the bug in one place.
 *
 * Format: (XXX) XXX-XXXX. Anything past the 10th digit is dropped, so
 * leading-1 country codes pasted as "+1 760 672 5520" come out clean.
 *
 * Use formatPhone on every keystroke (it's a no-op pass-through when
 * the input is already formatted as expected). Pair with stripPhone
 * when persisting — the formatted display is for humans; the
 * normalized digits-only string is the canonical form for storage
 * and comparison.
 */

export function formatPhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 10)
  if (digits.length === 0) return ''
  if (digits.length <= 3) return `(${digits}`
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

/** Strip everything except digits. Use before persisting a phone number. */
export function stripPhone(raw: string): string {
  return (raw || '').replace(/\D/g, '')
}

/**
 * Dash-style variant: `XXX-XXX-XXXX`. Used on CRM surfaces (person
 * detail, contact list, order header recipient) where the parens
 * style feels heavier than the layout wants. Same partial-format
 * semantics as `formatPhone` — feed it on every keystroke for
 * incremental formatting as the user types.
 *
 * Edge cases preserved verbatim (NOT mangled) — return raw input:
 *   - Extensions:           "555-1234 x123", "555-1234, ext 5"
 *   - International:        starts with `+` and isn't `+1` US
 *   - Anything past 10 digits after stripping a leading 1
 * The motivation: a UPM's number might be "+44 20 7946 0958" or
 * "(818) 555-0123 x412" — formatPhoneDashed would otherwise drop
 * the country code or the extension. Better to leave the human's
 * input alone than to strip information silently.
 *
 * A leading `1` on an 11-digit input is treated as the US country
 * code and stripped so "1-760-672-5522" formats as "760-672-5522".
 */
export function formatPhoneDashed(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  // Extension marker — leave alone
  if (/[xX](?:t|tn|t\.|ext)?\b/.test(trimmed) || /,\s*ext/i.test(trimmed)) return raw
  // Non-US international — leave alone (US "+1" still formats)
  if (trimmed.startsWith('+') && !/^\+1\b/.test(trimmed) && !/^\+1\s*\(?\d/.test(trimmed)) return raw

  let digits = trimmed.replace(/\D/g, '')
  // Strip a leading 1 only when the remaining 10 digits form a clean
  // US number. "11234567890" → keep all 11 (treat as international).
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  // Anything > 10 after the 1-strip is non-standard; leave the
  // human's input untouched.
  if (digits.length > 10) return raw

  if (digits.length === 0) return ''
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}
