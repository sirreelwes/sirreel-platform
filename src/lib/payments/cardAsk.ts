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

/**
 * ── Telling the CLIENT, in their own portal ────────────────────────────
 *
 * Wes, 2026-09-18: "I don't understand how they were able to submit a card
 * that was declined." They were, and the answer is deliberate on one path and
 * a hole on another:
 *
 *   - Staff keying a card (/crm/[id]#cards) is REFUSED on a decline. Nothing
 *     is stored. That is correct and unchanged.
 *   - The client's own portal (/api/portal/[token]/sign, step cc) STORES the
 *     row anyway, because that one statement also carries their signature,
 *     their payment preference and their cardholder details — refusing the
 *     card would throw all of it away with the client standing there mid-form.
 *     That much is right.
 *
 * What was wrong is that the route then answered 200 and the card reported
 * itself authorized. The client saw a green "Credit Card Authorized", believed
 * they were done, and walked away; the desk got an email about a card only the
 * client could replace. The one person who could fix it in ten seconds, with
 * their wallet still open, was the one person nobody told.
 *
 * So the storage stays and the SUCCESS CLAIM goes.
 *
 * ── Why "declined" is not the same as "not validated" ──────────────────
 *
 * `CardOnFileSummary.validated` is `authRespStat === 'A'`, which reads FALSE
 * for a card that was refused AND for one nobody ever checked — every card
 * stored before the $0 validation shipped (2026-09-01) is in the second group.
 * On a staff surface that conflation is a chip somebody shrugs at. On this one
 * it would tell a client their perfectly good card was refused by their bank,
 * which is worse than the silence it replaces. Hence `authChecked`: these
 * notices fire only on a card we actually asked the gateway about and got a
 * "no" for.
 *
 * Both strings say the same three things — it did not go through, nothing was
 * charged, add a different one — and neither guesses WHY. We do not know, the
 * client's bank will not tell us, and "insufficient funds" guessed wrong at a
 * production's accounting desk is its own phone call.
 */

/** Shown the moment a client's card comes back declined, on the form they
 *  just submitted. Names what survived, so nobody redoes their signature. */
export const CARD_DECLINED_AT_SUBMIT =
  'Your bank did not approve this card, so we cannot use it for the rental. Nothing was charged. Your signature and details are saved — please add a different card below.'

/** Shown to a client who comes back later to a card that is on file and dead.
 *  Without it the portal greets them with the same green "Authorized" panel
 *  and the fix above lasts exactly until they refresh the page. */
export const CARD_DECLINED_ON_FILE =
  'Your bank did not approve this card, so we cannot charge it. Nothing was charged. Please add a different card — the one below stays on file until you do.'

/** Is this card one we asked the gateway about and were told no?
 *  False for a card that was approved, and false for one never checked. */
export function clientCardWasDeclined(card: {
  authChecked?: boolean | null
  validated?: boolean | null
}): boolean {
  return card.authChecked === true && card.validated === false
}

/** The three facts every card surface has about whether a card will charge. */
export interface CardUsability {
  authChecked?: boolean | null
  validated?: boolean | null
  expired?: boolean | null
}

/**
 * Would we expect this card to charge?
 *
 * Refused or expired is a no; ANYTHING ELSE is a yes, including a card we
 * never checked. That default is deliberate and load-bearing: on 2026-09-06,
 * 21 of the 23 bookings going out in the next 14 days held no HQ-validated
 * card at all, because their authorization lives in Cognito or RentalWorks.
 * Treating "we never asked" as unusable would light up almost every job on
 * the board and train everyone to ignore the row.
 */
export function isCardUsable(card: CardUsability): boolean {
  return !clientCardWasDeclined(card) && card.expired !== true
}

/**
 * Does this client owe us a REPLACEMENT — cards on file, none of them good?
 *
 * The three-way split this encodes, and why the middle case needed a name:
 *
 *   no cards at all        → the `card-required` action item already owns it,
 *                            and the yard's gate refuses the check-out.
 *   cards, none usable     → THIS. Invisible to both of the above, because
 *                            every existence check in HQ — card-required's
 *                            NOT EXISTS, cardGateForJob's `onFile` — is
 *                            satisfied by the very card that will fail.
 *   at least one usable    → nothing to chase. A production that added a
 *                            good second card after the first was refused is
 *                            covered, and must not be nagged about the dead
 *                            one still sitting on their account.
 *
 * Same predicate the client's own portal reads for its red banner, so what
 * HQ chases and what the client is being told cannot drift apart.
 */
export function replacementNeeded(cards: CardUsability[]): boolean {
  return cards.length > 0 && !cards.some(isCardUsable)
}
