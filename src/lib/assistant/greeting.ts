/**
 * When AHA greets a person by name — decided by the SERVER from the
 * thread's timestamps, so the prompt is told "greet" or "don't", never
 * left to guess.
 *
 * Wes 2026-09-11: "a-ha should seem very personal … 'Hi, Joelle!' the
 * first time they reach out. Don't overuse the first name, but use it
 * naturally, so if it's been an hour or more since the last contact,
 * work it into the conversation again."
 *
 *   first      — nothing has ever passed on this thread: greet by name.
 *   returning  — an hour or more since the last message either way: greet
 *                by name again, lightly.
 *   none       — mid-conversation: the name is available but not called for.
 *
 * The timestamps are read from the thread AS FETCHED before the new inbound
 * is recorded, so "last contact" means the previous message, not this one.
 * Pure; tests pin the boundaries.
 */
export const RETURNING_AFTER_MS = 60 * 60 * 1000

export type GreetingMoment = 'first' | 'returning' | 'none'

export function greetingMoment(
  thread: { lastInboundAt: Date | null; lastOutboundAt: Date | null },
  now: Date = new Date(),
): GreetingMoment {
  const last = [thread.lastInboundAt, thread.lastOutboundAt].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0]
  if (!last) return 'first'
  return now.getTime() - last.getTime() >= RETURNING_AFTER_MS ? 'returning' : 'none'
}

/** First name from whatever HQ has: "Joelle Park" → "Joelle"; empty → null. */
export function firstNameOf(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const first = (c ?? '').trim().split(/\s+/)[0]?.replace(/[,.]+$/, '')
    if (first && /^[\p{L}][\p{L}'’-]*$/u.test(first)) return first
  }
  return null
}

/** The prompt block. Empty when there is no name to use. */
export function greetingInstruction(moment: GreetingMoment, firstName: string | null): string {
  if (!firstName) return ''
  const rules = `Their first name is ${firstName}. Use it the way a person would — never in every message, at most once in a reply, and not in back-to-back replies unless it reads naturally. Never use a surname.`
  if (moment === 'first') {
    return `\n\nGREETING: this is their first message to us ever. Open with "Hi ${firstName}!" before anything else. ${rules}`
  }
  if (moment === 'returning') {
    return `\n\nGREETING: it has been an hour or more since you last spoke. Greet them by name once at the start, like "Hi ${firstName}, welcome back" or "Hey ${firstName}", then get to it. ${rules}`
  }
  return `\n\nNAME: ${rules} You are mid-conversation — do not greet again.`
}
