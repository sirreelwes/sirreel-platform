/**
 * The SirReel texting number, formatted for people.
 *
 * Lived as a private copy inside the /sms-terms page until 2026-09-16, when
 * the troubleshooting pages needed the same thing. Two copies of a number
 * formatter is how one page ends up showing a stale number after a carrier
 * change, so it is one function now.
 *
 * Falls back to a phrase rather than a blank when TWILIO_FROM_NUMBER is
 * unset — the campaign filing requires the number to be reachable in copy,
 * and an empty string reads as a bug.
 */
export function smsNumberDisplay(raw = process.env.TWILIO_FROM_NUMBER): string {
  const digits = (raw || '').replace(/\D/g, '')
  const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : 'our SirReel text number'
}
