/**
 * The assistant's name — one place, imported by the prompt, both chat
 * surfaces, the help page and the admin page, so it cannot drift.
 *
 * Wes 2026-09-10: "AHA" — SirReel After Hours Assistant. Rules that come
 * with giving it a name:
 *   - It still says it is automated. A name makes it feel like a person;
 *     the first line makes clear it is not a staff member, which is what
 *     keeps the code-release and emergency rules credible.
 *   - Texts still name the company. The carrier campaign filed that every
 *     message identifies SirReel Studio Services, so AHA introduces itself
 *     WITH the brand, never instead of it. The keyword replies
 *     (KEYWORD_REPLIES in src/lib/sms/threads.ts) are carrier-filed strings
 *     and do not carry the name.
 *
 * Pure constants — safe to import from client components.
 */
export const ASSISTANT_NAME = 'AHA'
export const ASSISTANT_EXPANSION = 'SirReel After Hours Assistant'
/** "AHA — SirReel After Hours Assistant" */
export const ASSISTANT_FULL_NAME = `${ASSISTANT_NAME} — ${ASSISTANT_EXPANSION}`

/** The chat greeting — first bubble in the widget and on /help. */
export const ASSISTANT_GREETING_TEXT =
  `Hi — I'm ${ASSISTANT_NAME}, SirReel's After Hours Assistant. I'm automated, and I can help with things like a lost vehicle access code, directions, gear setup, or getting a message to your agent. What do you need?`

/** How the assistant opens a text conversation (the campaign requires the brand name in every text). */
export const ASSISTANT_SMS_INTRO =
  `This is ${ASSISTANT_NAME}, SirReel Studio Services' automated after-hours assistant.`
