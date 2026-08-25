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
 *     notifications@ is NOT one of the 11 mailboxes HQ ingests. So a
 *     client hitting reply lands in an address nobody works. Reply-To
 *     fixes this, and it's the more serious of the two.
 *
 * Both point at the shared ops inbox. Override or clear with
 * TEAM_INBOX_EMAIL — empty string disables both, which is how this gets
 * retired: no deploy, just unset it.
 *
 * NOTE for whoever adds rentals@ to the ingested mailboxes later: at that
 * point our own CC'd outbound starts arriving in HQ, so the ingestion
 * needs to ignore mail sent from our own domain or it will manufacture
 * inquiries from our own replies.
 */

const DEFAULT_TEAM_INBOX = 'rentals@sirreel.com'

/** The shared inbox, or null when deliberately disabled. */
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
