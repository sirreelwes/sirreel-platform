/**
 * Is there something for an executive to sign, and is the account's current
 * coverage actually EXECUTED?
 *
 * Pure and its own module because THREE surfaces have to agree and two of
 * them are client components — and all three got it wrong the same way:
 *
 *  - the account portal's terms card read `terms.annual ? … : terms.pendingAnnual ? …`,
 *    so a covering master hid the Sign button entirely;
 *  - the invite composer gated the sign link on `!annual && pending`, so the
 *    email to the person who was going to sign never mentioned the document
 *    or carried its link;
 *  - the sign page told a signer "your account already has a signed annual
 *    agreement … Nothing to sign." over a master nobody had signed.
 *
 * That is the third state this account model has carried since the
 * negotiated masters were filed on 2026-09-18: **covering, unsigned,
 * offered.** A master filed with `autoCoverJobs: true` papers every job in
 * its window with no signature on it, so coverage is not evidence of a
 * signature and must never be allowed to hide the signing ask — the ask is
 * the whole reason for offering.
 *
 * The rule: a PENDING offer is always signable. Somebody at the desk pressed
 * "Offer annual agreement" for it; `signAnnual` only ever supersedes masters
 * that nobody signed; and next year's agreement offered while this year's
 * executed copy still holds is a real case, not a mistake to guard against.
 * `executed` is the separate fact — the only thing that means "nothing to
 * sign", and only when no offer is waiting.
 *
 * Dates are `Date | string` because the server reads them off Prisma and the
 * portal pages read them off JSON. Only the presence of `signedAt` decides
 * anything here, so both shapes answer the same question.
 */

export interface AnnualCoverageFacts {
  title?: string | null
  signerName?: string | null
  signedAt: Date | string | null
  expiryDate?: Date | string | null
}

export interface AnnualSigningState<P> {
  /** The offer to put in front of a signer, if any. */
  signable: P | null
  /** Coverage with a signature on it. Informational, never a block. */
  executed: AnnualCoverageFacts | null
  /**
   * Coverage is holding with nobody's signature on it while an offer waits.
   * Surfaces say so out loud rather than choosing one of the two facts: the
   * terms ARE in force, and the signature is still owed.
   */
  coveringUnsigned: boolean
}

export function annualSigningState<P>(input: {
  coverage: AnnualCoverageFacts | null
  pending: P | null
}): AnnualSigningState<P> {
  const { coverage, pending } = input
  return {
    signable: pending ?? null,
    executed: coverage && coverage.signedAt ? coverage : null,
    coveringUnsigned: !!coverage && !coverage.signedAt && !!pending,
  }
}
