/**
 * The one sentence every client-facing SirReel email opens with.
 *
 * Wes, 2026-08-12. Lives here rather than in either template so the quick
 * reply and the welcome cannot drift into saying different things — the
 * whole point is that a client hears the same opening from SirReel however
 * they arrived.
 *
 * It deliberately promises nothing about availability, price or timing. The
 * copy it replaced did: the quick reply's "positive" tier told clients "we're
 * looking good on availability for your dates", which committed on the rep's
 * behalf before anyone had looked at the job. Specifics belong in the rep's
 * own words underneath, where a person is accountable for them.
 */
export const STANDARD_OPENING_LINE =
  "It's great to hear from you and we are looking forward to the opportunity to partner with you on this project."

/**
 * The PRE-JOB variant — for the two emails that go out before anyone has
 * agreed to anything: the quote, and the first-touch welcome.
 *
 * Wes, 2026-08-26. The quote email opened with "really glad we get to work on
 * this with you", which claims the job is already ours. At quote time we do
 * not have the job — we are asking for it. This line wants the work without
 * assuming it.
 */
export const PRE_JOB_OPENING_LINE =
  "It's great to hear from you — we'd love to work with you on this one."

/**
 * The editable DEFAULT body a rep starts from.
 *
 * Wes, 2026-08-12: the standard paragraph is a starting point, not a fixed
 * preamble — the rep can edit the whole email. So this text is prefilled into
 * "Write my own email" and, once edited, becomes the entire body. When a rep
 * writes nothing, the template renders this same text, so what they see in the
 * box is exactly what the client receives.
 *
 * Built server-side because only the server knows the project name.
 */
export function defaultEmailBody(input: {
  kind: 'quick-reply' | 'welcome' | 'quick-respond' | 'quote'
  projectName?: string | null
}): string {
  // The quote email. Deliberately names no job and no dates — the quote
  // snapshot block sits directly underneath and carries both. Kept free of
  // the project name so the text a rep is handed in the compose box is
  // character-for-character the text the client receives.
  if (input.kind === 'quote') {
    return [
      PRE_JOB_OPENING_LINE,
      '',
      "I've put together a first pass at your quote; it's waiting for you on your client portal, along with everything else we'll need for the job.",
    ].join('\n')
  }
  // Quick Respond gets the bare standard line and NOTHING else. Wes
  // 2026-08-25: "Do NOT tell client anything about availability etc. …
  // Generic language would be acceptable: Great to hear from you etc,
  // nothing specific." No project name, no portal, no promises — the rep
  // writes anything particular themselves.
  if (input.kind === 'quick-respond') return STANDARD_OPENING_LINE
  if (input.kind === 'welcome') {
    const project = input.projectName?.trim() || 'this project'
    return [
      STANDARD_OPENING_LINE,
      '',
      `We're excited to take care of your team on ${project}. Everything you'll need over the course of this project lives in one place — your TSX portal.`,
    ].join('\n')
  }
  return STANDARD_OPENING_LINE
}
