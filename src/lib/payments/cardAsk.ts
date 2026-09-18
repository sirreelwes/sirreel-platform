/**
 * "Ask the client for another card" — the one rule for whether HQ still owes
 * this client a card ask, and what to call the button.
 *
 * Wes, 2026-09-18: "Jose inputted a card for a client, which was declined, but
 * it says that there's no way for him to ask for a new card. We need a button
 * for that."
 *
 * Both halves of that sentence were true, in two different places:
 *
 *   1. The KEYED path (/crm/[id]#cards → "Key in a card the client
 *      authorized"). A card that fails the $0 stored-credential check is
 *      deliberately NOT stored — so the decline was a red sentence with
 *      nothing after it, on a screen that has no card ask of its own. Jose
 *      was standing on the company page; the ask lives on the job page, and
 *      nothing said so or took him there.
 *   2. The PORTAL path. There the unapproved authorization IS stored (the
 *      client is mid-form and the rest of their paperwork must not be lost),
 *      so the job's Card Authorization tile read "On file · ····4242" with
 *      the line "The $0 check was not approved — ask for another card"
 *      underneath it — an instruction with no control. The tile's "Send CC
 *      request" button renders only in the no-card branch, which is exactly
 *      the branch a declined card is not in.
 *
 * So the rule below answers one question — "is there a card ask open on this
 * job, and is it a REPLACEMENT?" — and the staff surfaces render it rather
 * than each deciding for themselves. Pure: no prisma, no fetch. The job page,
 * the company wallet panel and the email's default ask all read it, which is
 * what keeps the button, the sentence above it and the words the client
 * receives from drifting apart.
 *
 * `npm run test:card-ask`.
 */

/**
 * Why a card ask is open.
 *
 *   MISSING   — nothing on file. The original "Send CC request".
 *   DECLINED  — a card is on file but its $0 stored-credential check never
 *               came back approved. It reads as on file everywhere and fails
 *               at charge time.
 *   EXPIRED   — on file, validated once, and its MM/YY has since passed.
 *   NONE      — a live, validated card. Nothing to ask for.
 */
export type CardAskReason = 'MISSING' | 'DECLINED' | 'EXPIRED' | 'NONE'

export interface CardAskState {
  /** Is there something to ask the client for? */
  ask: boolean
  reason: CardAskReason
  /** A card is already on file — this ask is for a DIFFERENT one. Drives the
   *  button label and the wording of the email that goes out. */
  replacement: boolean
  /** Button label. */
  label: string
  /** One line under it, in the staff's own terms. */
  why: string
}

/** The shape every card surface already carries (JobCardOnFile, the wallet's
 *  CardOnFileSummary, the /api/jobs/[id] cardAuth block). */
export interface CardAskInput {
  onFile: boolean
  /** The $0 stored-credential authorization came back approved. */
  validated?: boolean | null
  /** MM/YY already past. */
  expired?: boolean | null
}

const NOTHING: CardAskState = {
  ask: false,
  reason: 'NONE',
  replacement: false,
  label: '',
  why: '',
}

/**
 * DECLINED outranks EXPIRED when a card is both, which it usually is — an
 * expired card also fails the $0 check, so the two arrive together. The
 * precedence matches what the job tile has said since 2026-09-01 and keeps
 * the sharper fact (the bank refused it) in front of the rep.
 *
 * `null` means no card at all, which is MISSING rather than NONE: "nothing to
 * ask for" and "nobody has been asked" are opposite states and collapsing
 * them is how the original ask went missing on a job with no card.
 */
export function cardAskState(card: CardAskInput | null | undefined): CardAskState {
  if (!card || !card.onFile) {
    return {
      ask: true,
      reason: 'MISSING',
      replacement: false,
      label: 'Send CC request',
      why: 'No card on file yet',
    }
  }
  if (card.validated === false) {
    return {
      ask: true,
      reason: 'DECLINED',
      replacement: true,
      label: 'Ask for another card',
      why: 'The $0 check on this card was not approved — it will fail at charge time',
    }
  }
  if (card.expired === true) {
    return {
      ask: true,
      reason: 'EXPIRED',
      replacement: true,
      label: 'Ask for another card',
      why: 'That card has expired',
    }
  }
  return NOTHING
}

/**
 * The client-facing ask, when a card is already on file.
 *
 * The default body ("Before we can send <production> out the door, we need a
 * credit card on file") is right for MISSING and wrong for the two states
 * this feature exists for: a client who typed their card in last week and is
 * now told we need one reads it as our mistake, and has no idea theirs was
 * refused. The rep can always edit the box — this is what they are handed.
 *
 * Deliberately vague about WHY the bank refused it. We do not know, the
 * client's bank will not tell us, and guessing in an email to a production's
 * accounting contact is not ours to do.
 */
export function cardAskClientSentence(
  reason: CardAskReason,
  projectName: string | null | undefined,
): string | null {
  const project = projectName?.trim() || 'your production'
  if (reason === 'DECLINED') {
    return `The card we have on file for ${project} did not go through when we verified it, so we need a different one before the rental can go out.`
  }
  if (reason === 'EXPIRED') {
    return `The card we have on file for ${project} has expired, so we need a current one before the rental can go out.`
  }
  return null
}
