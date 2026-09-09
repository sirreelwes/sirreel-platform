/**
 * Who the team desk measures, and through which mailboxes.
 *
 * ── Why a hand-written roster rather than "every active User" ─────────────
 * Because the measurement is not uniform, and pretending it is would be the
 * whole bug. A sales rep's outcome is a booked order; Ana's is a cleared
 * invoice. Those come from different tables and cannot be added together.
 * Each person therefore declares their KIND, and the desk computes the
 * outcome family that actually applies to them.
 *
 * Adding someone is a two-line change here — but read `sendAddresses` first.
 *
 * ── sendAddresses: shared mailboxes are deliberately excluded ─────────────
 * info@, hello@, jobs@ and studios@ are worked by more than one person. A
 * message sent from one of them is not attributable to anybody, so counting
 * it would credit whoever happens to be on the roster. They are left out,
 * which means email EFFORT here is a floor, not a total: a rep who answers
 * a lead from info@ gets no credit for it on this page. Sales OUTCOMES do
 * not have this problem — Order.agentId is stamped per order regardless of
 * which mailbox the conversation lived in.
 *
 * Ana is the reverse case: billing@ and payments@ are hers in practice, so
 * they count for her. If a second person ever works billing@, remove it from
 * her list rather than splitting the credit — an over-count attributed to a
 * named person is worse than a gap.
 *
 * ── The dedup trap this roster is shaped around ───────────────────────────
 * src/lib/email/watchedInboxes.ts documents it: billing@/payments@/jobs@
 * forward into ana@, and cross-inbox dedup marks ana@'s copy `duplicateOfId`
 * whenever the other inbox's row is canonical. So counting inbound mail by
 * `emailAccount` alone UNDER-counts Ana badly. Every inbound query on this
 * desk goes through routingHeaders.deliveredTo first for exactly that
 * reason — see metrics.ts.
 */

export type PersonKind = 'SALES' | 'COLLECTIONS'

export interface WatchedPerson {
  /** Their User.email — the join key to Order.agentId, AuditLog.userId etc. */
  email: string
  /** Display name on the card. */
  name: string
  kind: PersonKind
  /** Addresses whose OUTBOUND mail is unambiguously this person's. */
  sendAddresses: string[]
  /** Mailboxes whose INBOUND mail is this person's to answer. Drives the
   *  responsiveness tab. */
  inboxes: string[]
  /** Shown on the card so the numbers are read with their limits attached. */
  caveat?: string
}

export const WATCHED_PEOPLE: readonly WatchedPerson[] = [
  {
    email: 'ana@sirreel.com',
    name: 'Ana',
    kind: 'COLLECTIONS',
    sendAddresses: ['ana@sirreel.com', 'billing@sirreel.com', 'payments@sirreel.com'],
    inboxes: ['ana@sirreel.com', 'billing@sirreel.com', 'payments@sirreel.com'],
    caveat:
      'billing@ and payments@ run a positive-only ingest filter, so her inbound is already ' +
      'money-filtered — it is not comparable to a sales inbox. Collections work done inside ' +
      'RentalWorks itself is invisible here.',
  },
  {
    email: 'jose@sirreel.com',
    name: 'Jose Pacheco',
    kind: 'SALES',
    sendAddresses: ['jose@sirreel.com'],
    inboxes: ['jose@sirreel.com'],
    caveat: 'Leads he works out of the shared info@ / hello@ inboxes do not count toward his email numbers.',
  },
  {
    email: 'oliver@sirreel.com',
    name: 'Oliver Carlson',
    kind: 'SALES',
    sendAddresses: ['oliver@sirreel.com'],
    inboxes: ['oliver@sirreel.com'],
    caveat: 'Leads he works out of the shared info@ / hello@ inboxes do not count toward his email numbers.',
  },
]

export function findWatched(email: string): WatchedPerson | undefined {
  const e = email.toLowerCase()
  return WATCHED_PEOPLE.find((p) => p.email === e)
}
