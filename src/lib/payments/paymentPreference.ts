/**
 * How the client SAID they intend to pay, captured alongside the card
 * authorization.
 *
 * This is an INTENT SIGNAL for staff, never a gate: the card is authorized
 * and kept on file as a guarantee for deposits, unpaid balances and damages
 * whichever value this holds.
 *
 * 'UNDECIDED' is a real answer, not a missing one (Wes, 2026-09-02). The
 * portal used to offer card-or-check only, with the radio pre-selected on
 * CARD — so a client who simply had not decided yet was recorded as having
 * chosen the card, and every staff surface read that as consent to the 3%
 * processing fee. Keep it distinct from `null`, which means the question was
 * never put to them at all (legacy rows predating the preference field).
 */
export type PaymentPreference = 'CARD' | 'CHECK_WIRE' | 'UNDECIDED'

/**
 * Coerce a stored string to a known preference. Anything unrecognised —
 * including the empty string — becomes null ("never asked") rather than
 * silently defaulting to CARD.
 */
export function normalizePaymentPreference(
  v: string | null | undefined,
): PaymentPreference | null {
  return v === 'CHECK_WIRE'
    ? 'CHECK_WIRE'
    : v === 'UNDECIDED'
      ? 'UNDECIDED'
      : v === 'CARD'
        ? 'CARD'
        : null
}

/** Short staff-facing description of the client's stated intent. */
export function paymentPreferenceLabel(v: string | null | undefined): string {
  switch (normalizePaymentPreference(v)) {
    case 'CARD':
      return 'card on file'
    case 'CHECK_WIRE':
      return 'check / wire (card is security only)'
    case 'UNDECIDED':
      return 'not decided yet (card is on file as guarantee)'
    default:
      return 'not stated'
  }
}
