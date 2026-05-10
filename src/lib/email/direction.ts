/**
 * Inbound vs outbound classification for inbox messages.
 *
 * A single source of truth used by:
 *   - Gmail Pub/Sub ingest (src/app/api/gmail/pubsub/route.ts) — sets
 *     EmailMessage.direction and updates the parent EmailThread's
 *     last{Inbound,Outbound}At + lastDirection.
 *   - Backfill seeds — assign lastDirection on existing threads.
 *   - Pipeline / sales code — anywhere we need to know whether a thread
 *     is awaiting an agent reply.
 *
 * Returns uppercase 'INBOUND' / 'OUTBOUND' to match
 * EmailThread.lastDirection storage. The legacy
 * EmailMessage.direction column uses lowercase strings — callers writing
 * to that column should `.toLowerCase()` the result.
 */

export type EmailDirection = 'INBOUND' | 'OUTBOUND'

/**
 * Known agent-side mailboxes. Anything from these addresses (or any
 * @sirreel.com address) is OUTBOUND. Update this when a new SirReel
 * mailbox starts being monitored.
 */
export const SIRREEL_AGENT_ADDRESSES: readonly string[] = [
  'info@sirreel.com',
  'jose@sirreel.com',
  'oliver@sirreel.com',
  'ana@sirreel.com',
  'wes@sirreel.com',
  'dani@sirreel.com',
  'hugo@sirreel.com',
  'julian@sirreel.com',
  'chris@sirreel.com',
  'christian@sirreel.com',
]

/**
 * Extract the bare email address from a "Display Name <addr@host>" header.
 * Returns the input lowercased+trimmed if no angle-bracket form is found.
 */
export function parseEmailAddress(fromHeader: string): string {
  const angle = fromHeader.match(/<([^>]+)>/)
  const raw = angle ? angle[1] : fromHeader
  return raw.toLowerCase().trim()
}

/**
 * Classify a single message by its From: header value. Pass either the
 * raw header (`"Oliver Carlson <oliver@sirreel.com>"`) or the bare
 * address — both work.
 */
export function getMessageDirection(fromHeader: string): EmailDirection {
  const addr = parseEmailAddress(fromHeader)
  if (!addr) return 'INBOUND'
  if (addr.endsWith('@sirreel.com')) return 'OUTBOUND'
  if (SIRREEL_AGENT_ADDRESSES.includes(addr)) return 'OUTBOUND'
  return 'INBOUND'
}
