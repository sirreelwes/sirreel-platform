/**
 * Dismissing a payment-info request needs a "how was it handled" note.
 *
 * Wes 2026-09-15: Maddy at Contrast asked for payment details, a teammate
 * sent them outside HQ, and the inquiry was dismissed. Dismiss recorded
 * nothing — no note, no audit — so a DISMISSED payment-info request read as
 * "never answered" and she was sent the details a second time. The PATCH
 * route now refuses to dismiss one without a note (so no button can skip
 * it), and both Dismiss buttons ask for it here.
 */

/** Payment-info requests are typed by the fixed title the /payment-info
 *  public route gives them. */
export function isPaymentInfoInquiry(title: string | null | undefined): boolean {
  return (title ?? '').trim().toLowerCase() === 'payment info request'
}

export const HANDLED_NOTE_MAX = 500

/**
 * Browser-only. Asks how the request was handled; re-asks on a blank
 * answer. Returns the note, or null when the user cancels (don't dismiss).
 */
export function askHowPaymentInfoWasHandled(): string | null {
  let message =
    'How was this payment-info request handled?\n\n' +
    'e.g. "Ana emailed the details", "sent from the job page", "duplicate", "not a real client"'
  for (;;) {
    const answer = window.prompt(message, '')
    if (answer === null) return null
    const note = answer.trim()
    if (note) return note.slice(0, HANDLED_NOTE_MAX)
    message = 'A note is required so the next person knows whether the details went out.\n\nHow was it handled?'
  }
}
