/**
 * Which email domains may sign in to HQ — the single predicate behind every
 * sign-in gate. Same shape and reasoning as src/lib/hr/allowlist.ts and
 * src/lib/collections/allowlist.ts: one module so the enforcement points can
 * never disagree with each other.
 *
 * Set AUTH_ALLOWED_EMAIL_DOMAINS in Vercel as a comma-separated list. Unlike
 * HR_ALLOWLIST this REPLACES the default rather than merging with it — the
 * domain list is the whole tenancy boundary, so "remove sirreel.com" has to be
 * expressible once HQ belongs to VerMar. Unset or empty falls back to
 * ['sirreel.com'], which is exactly today's behaviour.
 *
 * Written as a list from the start because this becomes per-tenant domain
 * allowlisting for whitelabel; a second hardcoded string would have to be
 * torn out again.
 *
 * Usage:
 *   import { isAllowedEmailDomain } from '@/lib/authDomains'
 *   if (!isAllowedEmailDomain(user.email)) return false
 */

const FALLBACK_DOMAINS: ReadonlyArray<string> = ['sirreel.com']

/**
 * Parsed once at module load. Domains are lowercased and stripped of a leading
 * '@' so both "sirreel.com" and "@sirreel.com" work in the env var.
 */
const ALLOWED_DOMAINS: ReadonlyArray<string> = (() => {
  const raw = process.env.AUTH_ALLOWED_EMAIL_DOMAINS ?? ''
  const parsed = raw
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  return parsed.length > 0 ? parsed : FALLBACK_DOMAINS
})()

/** The active list, for diagnostics and for tests. */
export function allowedEmailDomains(): ReadonlyArray<string> {
  return ALLOWED_DOMAINS
}

/**
 * Exact match on the part after the final '@'.
 *
 * Deliberately not a suffix test: `endsWith('sirreel.com')` would also admit
 * `evil-sirreel.com`, and matching subdomains would admit anyone who can get a
 * mailbox at a subdomain of an allowed domain. A domain either is on the list
 * or it is not.
 */
export function isAllowedEmailDomain(email: string | null | undefined): boolean {
  if (!email) return false
  const at = email.lastIndexOf('@')
  if (at === -1) return false
  const domain = email.slice(at + 1).trim().toLowerCase()
  if (!domain) return false
  return ALLOWED_DOMAINS.includes(domain)
}
