/**
 * Email normalization + alias-aware Person resolution.
 *
 * ROOT-CAUSE PRINCIPLE: the original "Wes@" vs "wes@" dupe slipped past
 * Person.email's @unique because the index is case-SENSITIVE in Postgres.
 * Two policies enforce dedup here:
 *
 *   1) Every WRITE path normalizes email to lowercase + trim before
 *      hitting `prisma.person.create/upsert/update`. Once all rows are
 *      lowercased, @unique becomes effectively case-insensitive in
 *      practice — there's no value that differs only in case. See the
 *      one-shot scripts/lowercasePersonEmails.ts backfill.
 *
 *   2) Every READ-by-email path goes through resolvePersonByEmail() so
 *      PersonEmailAlias resolution is automatic. If a caller bypasses
 *      this helper and hits `prisma.person.findUnique({where:{email}})`
 *      directly, the loser's old email (now an alias) won't resolve to
 *      the survivor — the alias table becomes decorative.
 *
 * Both rules must hold or merging is undone by the next inbound email.
 */

import { prisma } from '@/lib/prisma'

/**
 * Lowercase + trim. The ONLY safe form of a Person email going onto
 * the DB. Never call with a Gmail header value raw — extract the
 * mailbox address first (foo@bar.com without name/display), then pass
 * through here.
 */
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase()
}

/**
 * Same input shape as `prisma.person.findUnique({where:{email}})`
 * returns — a Person row — but checks both Person.email (the canonical
 * column) AND PersonEmailAlias.email (loser emails routed to a
 * survivor via a past merge). Lookup is case-insensitive on both
 * tables; with normalized writes this is belt-and-suspenders, not
 * required for correctness.
 *
 * Returns the first match; if both an alias and a Person row exist for
 * the same lowercased email (shouldn't happen — see invariant below),
 * the Person row wins.
 *
 * INVARIANT: `Person.email` and `PersonEmailAlias.email` must never
 * carry the same value pointing at different Persons. Enforced at
 * merge time: when the loser's email becomes an alias, the loser's
 * Person row is deleted in the same transaction, so the canonical
 * column no longer holds that string anywhere.
 *
 * Pass `select` / `include` like you would on prisma.person.findUnique
 * — passed through to whichever lookup wins.
 */
export async function resolvePersonByEmail(
  emailRaw: string,
  options?: { include?: Record<string, unknown>; select?: Record<string, unknown> },
) {
  const email = normalizeEmail(emailRaw)
  if (!email) return null

  // Person.email is stored lowercase post-backfill; the case-insensitive
  // filter keeps lookups working during the transition window for any
  // legacy mixed-case row that escaped normalization.
  const direct = await prisma.person.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    ...(options?.select ? { select: options.select } : {}),
    ...(options?.include ? { include: options.include } : {}),
  } as Parameters<typeof prisma.person.findFirst>[0])
  if (direct) return direct

  const alias = await prisma.personEmailAlias.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { personId: true },
  })
  if (!alias) return null

  return prisma.person.findUnique({
    where: { id: alias.personId },
    ...(options?.select ? { select: options.select } : {}),
    ...(options?.include ? { include: options.include } : {}),
  } as Parameters<typeof prisma.person.findUnique>[0])
}
