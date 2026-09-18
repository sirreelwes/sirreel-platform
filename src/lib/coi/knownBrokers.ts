/**
 * Brokers Wes has named by hand, so the directory does not start empty.
 *
 * Plain data — no prisma. Seeded by `seedKnownBrokers()` (the lib), reached
 * from /admin/maintenance or the CLI. Adding a row here is NOT the normal
 * way a broker gets on the list: the directory fills itself from the
 * PRODUCER box of every certificate we review and from every review link we
 * send (src/lib/coi/brokerDirectory.ts). This file is for the ones we knew
 * before the code did.
 *
 * ── The agency is left blank on purpose ────────────────────────────────────
 * `barbara@worthingtoninsur.com` obviously suggests "Worthington Insurance",
 * and the COI prompt tells the model in as many words never to infer an
 * agency from an email domain. Writing the guess here — where it would look
 * like a confirmed fact, in the row a rep reads before emailing a stranger —
 * would be the same mistake with a person's hand on it instead. The blank
 * fills itself the first time we review a certificate she issued.
 */

export interface KnownBroker {
  email: string
  name: string
  agency?: string
  phone?: string
  /** Staff-only, shown on /admin/brokers: where this row came from. */
  notes?: string
  /**
   * A CLIENT to tie them to, matched by name, case-insensitive, contains.
   * Linked ONLY when the search finds exactly one company — an ambiguous
   * match is reported and left for a person, because a broker filed under
   * the wrong client is how a production's insurance question reaches
   * someone else's agent.
   */
  companyNameHint?: string
}

export const KNOWN_BROKERS: readonly KnownBroker[] = [
  {
    email: 'barbara@worthingtoninsur.com',
    name: 'Barbara Wagner',
    companyNameHint: 'mega',
    notes:
      'Named by Wes 2026-09-17 — the broker on the Mega COI review. ' +
      'Agency not confirmed; it fills itself from the producer box of the next certificate she issues.',
  },
]
