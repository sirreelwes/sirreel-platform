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
