/**
 * Shared-inbox visibility for client-facing sales mail — a TRANSITION
 * measure (Wes 2026-08-25), to be retired once the team works
 * consistently in HQ.
 *
 * Two distinct problems, and CC only solves one:
 *
 *  1. The team can't see that a reply went out. An agent answering from
 *     HQ is invisible to everyone living in the shared inbox, so a second
 *     person can answer the same client. CC fixes this.
 *
 *  2. The CLIENT'S REPLY goes nowhere useful. Quick Reply sends From
 *     notifications@sirreel.com and sets no Reply-To, and
 *     notifications@ is NOT one of the mailboxes HQ ingests. So a client
 *     hitting reply lands in an address nobody works.
 *
 * These take DIFFERENT addresses, which matters:
 *
 *   · CC → the shared GROUP (rentals@). Wes 2026-08-25: it's a Google
 *     Group, not a mailbox — that's precisely why HQ can't watch it, and
 *     precisely why it's right for CC: it fans out to Jose, Oliver and
 *     Dani wherever they're working.
 *
 *   · Reply-To → the SENDING AGENT, never the group. Groups commonly
 *     reject mail from non-members, so pointing a client's reply at one
 *     risks a bounce — which would be worse than the black hole it
 *     replaced. The agent's own mailbox is also one HQ ingests, so the
 *     reply lands somewhere a human reads AND flows back into HQ.
 *
 * Override or clear the group with TEAM_INBOX_EMAIL — empty string
 * disables the CC, which is how this gets retired: no deploy, just unset.
 *
 * NOTE for whoever adds rentals@ to the ingested mailboxes later: at that
 * point our own CC'd outbound starts arriving in HQ, so the ingestion
 * needs to ignore mail sent from our own domain or it will manufacture
 * inquiries from our own replies.
 */

const DEFAULT_TEAM_INBOX = 'rentals@sirreel.com'

/** The shared group address, or null when deliberately disabled. */
export function teamInboxEmail(): string | null {
  const raw = process.env.TEAM_INBOX_EMAIL
  if (raw === undefined) return DEFAULT_TEAM_INBOX
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Merge the shared inbox into a rep-typed CC list without duplicating it
 * (case-insensitively) or shadowing the recipient.
 */
export function withTeamCc(existing: string[], recipient?: string | null): string[] {
  const team = teamInboxEmail()
  if (!team) return existing
  const seen = new Set(existing.map((e) => e.toLowerCase()))
  if (recipient && recipient.toLowerCase() === team.toLowerCase()) return existing
  if (seen.has(team.toLowerCase())) return existing
  return [...existing, team]
}

/**
 * Reply-To for client-facing sales mail: the agent who sent it.
 *
 * Deliberately NOT the shared group — see the header. Restricted to our
 * own domain so a session with an odd email can't redirect client replies
 * off-domain; anything else returns null and the reply falls back to the
 * From address.
 */
export function agentReplyTo(agentEmail: string | null | undefined): string | null {
  const e = (agentEmail || '').trim().toLowerCase()
  return /^[^\s@]+@sirreel\.com$/.test(e) ? e : null
}
