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
 * Merge the sales-team copy list into a rep-typed CC list without
 * duplicating entries (case-insensitively) or shadowing the recipient.
 *
 * Async since 2026-08-31: the audience is now the 'sales-team-cc'
 * notification channel (admin-managed at /admin/notifications), which
 * defaults to the TEAM_INBOX_EMAIL / rentals@ behavior above when no
 * override row exists. An admin override may hold several individual
 * addresses instead of the one group — every entry is merged.
 */
export async function withTeamCc(existing: string[], recipient?: string | null): Promise<string[]> {
  // Late import — teamVisibility is a dependency of the channel
  // registry's defaults, so a top-level import would be circular.
  const { channelRecipients } = await import('@/lib/email/notificationChannels')
  const team = await channelRecipients('sales-team-cc')
  if (team.length === 0) return existing
  const seen = new Set(existing.map((e) => e.toLowerCase()))
  if (recipient) seen.add(recipient.toLowerCase())
  const out = [...existing]
  for (const t of team) {
    const norm = t.trim().toLowerCase()
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    out.push(t.trim())
  }
  return out
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
