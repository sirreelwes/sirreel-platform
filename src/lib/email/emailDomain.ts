/**
 * Deliverability-risk checks based on the email address alone.
 *
 * Apple's iCloud Mail (me.com / icloud.com / mac.com) silently
 * filters a non-trivial fraction of legitimate transactional mail
 * — including SirReel quote sends + portal magic-link emails. The
 * mail is delivered to Apple's servers (no bounce / SMTP error
 * surfaces back to us), then dropped or quarantined invisibly to
 * the recipient. There's no fix on our side beyond confirming the
 * client received it or using another channel.
 *
 * Until Apple's filtering posture changes, every HQ surface that
 * shows a contact email or sends to one runs the address through
 * isHighRiskEmailDomain() to flag the risk to the agent.
 *
 * Derived-only — no schema, no DB writes. Matching is on the
 * domain part after the last @ (case-insensitive, trimmed).
 */
const HIGH_RISK_DOMAINS = new Set<string>([
  'me.com',
  'icloud.com',
  'mac.com',
])

export function isHighRiskEmailDomain(email: string | null | undefined): boolean {
  if (!email) return false
  const at = email.lastIndexOf('@')
  if (at < 0 || at === email.length - 1) return false
  const domain = email.slice(at + 1).trim().toLowerCase()
  return HIGH_RISK_DOMAINS.has(domain)
}
