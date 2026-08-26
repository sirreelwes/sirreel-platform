/**
 * Domain → Company resolution, shared by the live capture pipeline and
 * the affiliation backfill.
 *
 * This logic used to live privately inside captureFromEmail.ts. The
 * backfill needs exactly the same rule — a contact filed by the
 * backfill and the same contact filed by tomorrow's live capture must
 * land on the same company — so it moved here rather than being
 * copy-pasted. captureFromEmail.ts now imports it.
 *
 * The rule, unchanged from the original:
 *
 *   1. Freemail domains never match. A company whose billingEmail
 *      happens to be @gmail.com does not own gmail.com.
 *   2. Known vendor domains never match — those are OUR suppliers
 *      (insurance broker, CPA), not clients.
 *   3. A domain matches a Company when it appears in that company's
 *      `website` OR is the domain of its `billingEmail`.
 *   4. AMBIGUITY LOSES. Two companies matching one domain returns
 *      null, not a coin flip. With 4,193 companies on file and plenty
 *      of near-duplicate names, guessing wrong here would attach a
 *      contact to the wrong client and quietly corrupt targeting.
 */

import { prisma } from '@/lib/prisma'
import { FREEMAIL_DOMAINS, KNOWN_VENDOR_DOMAINS, SIRREEL_DOMAIN } from './captureConstants'

/** Lowercased domain of an email address, or '' when unparseable. */
export function domainOf(email: string | null | undefined): string {
  if (!email) return ''
  const m = email.match(/<([^>]+)>/)
  const bare = (m ? m[1] : email).trim().toLowerCase()
  const at = bare.lastIndexOf('@')
  return at < 0 ? '' : bare.slice(at + 1)
}

/**
 * True when a domain is eligible for company matching at all. Callers
 * that want to explain themselves to a human ("skipped: freemail")
 * should use `domainSkipReason` instead.
 */
export function isMatchableDomain(domain: string): boolean {
  return domainSkipReason(domain) === null
}

export type DomainSkipReason = 'empty' | 'freemail' | 'vendor' | 'internal'

/** Why a domain can't be matched, or null when it can. */
export function domainSkipReason(domain: string): DomainSkipReason | null {
  const d = domain.trim().toLowerCase()
  if (!d) return 'empty'
  if (d === SIRREEL_DOMAIN) return 'internal'
  if (FREEMAIL_DOMAINS.has(d)) return 'freemail'
  if (KNOWN_VENDOR_DOMAINS.has(d)) return 'vendor'
  return null
}

export interface DomainMatch {
  companyId: string
  companyName: string
  /** Which field produced the hit — surfaced in the backfill report. */
  via: 'website' | 'billingEmail'
}

/**
 * Resolve one domain to a single Company, or null.
 *
 * Kept as the one-off form for the live capture path (one message at a
 * time). The backfill uses `matchDomainsToCompanies` below, which does
 * the same thing for thousands of domains in two queries.
 */
export async function findDomainMatchedCompany(domain: string): Promise<string | null> {
  if (domainSkipReason(domain) !== null) return null
  const hits = await prisma.company.findMany({
    where: {
      OR: [
        { website: { contains: domain, mode: 'insensitive' } },
        { billingEmail: { endsWith: `@${domain}`, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
    take: 2,
  })
  return hits.length === 1 ? hits[0].id : null
}

/**
 * Bulk form: resolve many domains at once.
 *
 * Returns a map of domain → match for the domains that resolved to
 * EXACTLY one company, plus the set that matched more than one so the
 * caller can report them as ambiguous rather than silently dropping
 * them. Domains that matched nothing appear in neither.
 *
 * Two queries total regardless of input size: one pass over companies
 * with a website, one over companies with a billingEmail. Doing it
 * this way instead of N `findDomainMatchedCompany` calls turns a
 * 1,500-query backfill into two.
 */
export async function matchDomainsToCompanies(
  domains: Iterable<string>,
): Promise<{ matched: Map<string, DomainMatch>; ambiguous: Map<string, string[]> }> {
  const wanted = new Set<string>()
  for (const d of domains) {
    const lower = d.trim().toLowerCase()
    if (lower && domainSkipReason(lower) === null) wanted.add(lower)
  }
  const matched = new Map<string, DomainMatch>()
  const ambiguous = new Map<string, string[]>()
  if (wanted.size === 0) return { matched, ambiguous }

  const companies = await prisma.company.findMany({
    where: {
      OR: [{ website: { not: null } }, { billingEmail: { not: null } }],
    },
    select: { id: true, name: true, website: true, billingEmail: true },
  })

  // domain → candidate company ids (deduped), plus how we got there.
  const candidates = new Map<string, Map<string, DomainMatch>>()
  const add = (domain: string, m: DomainMatch) => {
    let bucket = candidates.get(domain)
    if (!bucket) { bucket = new Map(); candidates.set(domain, bucket) }
    // First hit wins the `via` label for a company already present —
    // website is scanned first, which is the stronger signal.
    if (!bucket.has(m.companyId)) bucket.set(m.companyId, m)
  }

  for (const c of companies) {
    const site = (c.website ?? '').toLowerCase()
    const billingDomain = domainOf(c.billingEmail)
    for (const d of wanted) {
      // `contains` semantics, matching the original single-row query.
      if (site && site.includes(d)) {
        add(d, { companyId: c.id, companyName: c.name, via: 'website' })
      } else if (billingDomain && billingDomain === d) {
        add(d, { companyId: c.id, companyName: c.name, via: 'billingEmail' })
      }
    }
  }

  for (const [domain, bucket] of candidates) {
    if (bucket.size === 1) {
      matched.set(domain, [...bucket.values()][0])
    } else {
      ambiguous.set(domain, [...bucket.values()].map((m) => m.companyName))
    }
  }
  return { matched, ambiguous }
}
