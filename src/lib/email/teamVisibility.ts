/**
 * Shared-inbox visibility for client-facing sales mail — a TRANSITION
 * measure (Wes 2026-08-25), RETIRED as a group CC on 2026-09-08.
 *
 * Two distinct problems, and CC only ever solved one:
 *
 *  1. The team can't see that a reply went out. An agent answering from
 *     HQ is invisible to everyone living in the shared inbox, so a second
 *     person can answer the same client. CC addressed this.
 *
 *  2. The CLIENT'S REPLY goes nowhere useful. Quick Reply sends From
 *     notifications@sirreel.com and sets no Reply-To, and
 *     notifications@ is NOT one of the mailboxes HQ ingests. So a client
 *     hitting reply lands in an address nobody works.
 *
 * (2) is still solved here, by agentReplyTo below: Reply-To is the
 * SENDING AGENT, never a group. Groups commonly reject mail from
 * non-members, so pointing a client's reply at one risks a bounce —
 * worse than the black hole it replaced. The agent's own mailbox is also
 * one HQ ingests, so the reply lands somewhere a human reads AND flows
 * back into HQ.
 *
 * (1) is no longer solved by mailing the desk. Wes 2026-09-08 —
 * "everyone is getting way too many emails" — and one copy per outbound
 * client email to rentals@ (Jose, Oliver, Dani) was the largest single
 * source of it. The 'sales-team-cc' channel now defaults to Wes alone;
 * the send itself is still on the order in HQ, which is where the team
 * was always meant to look.
 *
 * The TEAM_INBOX_EMAIL env var is gone with it — the audience is edited
 * at /admin/notifications now, and an env var that silently outranked
 * that page was a second place to look for the same answer. To put the
 * desk back on it, add rentals@sirreel.com to the channel there.
 *
 * NOTE for whoever adds rentals@ to the ingested mailboxes later: at that
 * point our own CC'd outbound starts arriving in HQ, so the ingestion
 * needs to ignore mail sent from our own domain or it will manufacture
 * inquiries from our own replies.
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
