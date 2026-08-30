/**
 * Did the rep open their own email with a greeting?
 *
 * The templates render "Hi <First>," above whatever the rep wrote. A rep
 * writing in the "Write my own email" box can't see that line, so they
 * naturally start with a greeting of their own — and the client receives
 *
 *     Hi Kacie,
 *     Hi again, Kacie!
 *
 * which is exactly what went out on 2026-08-29 before this existed.
 *
 * Two ways to fix a doubled greeting, and only one of them is safe:
 * strip the rep's line, or stand the template's down. Stripping edits
 * words a human chose — "Hi again, Kacie!" carries a beat that "Hi
 * Kacie," doesn't — so we keep theirs and drop ours.
 *
 * Deliberately narrow. It matches only a FIRST line that is entirely a
 * greeting: an opener word, optionally "again", optionally the
 * recipient's name, and nothing else of substance. A line that greets
 * and then says something ("Hi Kacie, quick update on the truck") is NOT
 * a bare greeting — it's the first sentence of the email, and swallowing
 * the template's greeting there would leave the mail with no greeting at
 * all.
 */

const OPENERS = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening', 'dear']

/**
 * True when `body`'s first line is nothing but a greeting.
 *
 * `firstName` is optional: a bare "Hi there," or "Hello!" still counts,
 * since the template greeting would duplicate its function either way.
 */
export function startsWithGreeting(
  body: string | null | undefined,
  firstName?: string | null,
): boolean {
  const first = (body ?? '').split('\n').map((l) => l.trim()).find((l) => l.length > 0)
  if (!first) return false

  // Strip trailing punctuation and any trailing name/"there" token set.
  const line = first.toLowerCase().replace(/[,!.—–-]+\s*$/, '').trim()
  const opener = OPENERS.find((o) => line === o || line.startsWith(o + ' ') || line.startsWith(o + ','))
  if (!opener) return false

  // What's left after the opener word(s).
  let rest = line.slice(opener.length).replace(/^[\s,]+/, '')
  rest = rest.replace(/^again\b/, '').replace(/^[\s,]+/, '')
  if (rest.length === 0) return true

  const name = (firstName ?? '').trim().toLowerCase()
  const allowed = new Set(['there', 'all', 'team', 'folks'])
  if (name) allowed.add(name)

  const tokens = rest.split(/[\s,]+/).filter(Boolean).map((t) => t.replace(/[^a-z']/g, ''))

  // With no name to check against, a single leftover token is a name
  // ("Hi Kacie,") — one word cannot be a sentence. More than one is
  // content, and the greeting stays.
  if (!name && tokens.length === 1) return true

  // Otherwise every remaining token must be an address term, not content.
  return tokens.every((tok) => allowed.has(tok))
}
