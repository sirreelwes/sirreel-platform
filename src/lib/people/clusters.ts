/**
 * Phone-cluster pre-classification — sorts candidate dupe clusters
 * into "likely dupe" vs "likely office mainline" so the reviewer
 * isn't wading through 40% noise unsorted.
 *
 * Heuristic (validated against the STEP-0 report on prod):
 *   - Same phone + every member shares the same normalized last name
 *     → LIKELY_DUPE (e.g. "Krystin Braverman" x4 across job emails)
 *   - Same phone + members have ≥2 distinct normalized last names
 *     → LIKELY_OFFICE_MAINLINE (e.g. Castex Rentals reception line:
 *       Alex, Carissa, Unknown, Laura)
 *   - Mixed signal (same first name but different last names; or
 *     surname variants like "Walker" vs "Elaine Walker") → UNCERTAIN
 *
 * Survivor pre-selection for LIKELY_DUPE clusters follows the ratified
 * priority order:
 *   1) most incoming FK refs
 *   2) User.personId linked (portal account)
 *   3) source != null (CRM-captured, carries rawTitle/lastKnownProject)
 *   4) earliest createdAt
 *
 * Pure data shape — no Prisma calls. Callers feed in the cluster
 * members + per-member ref counts and get back classification + pre-
 * selected survivor.
 */

export type ClusterClass = 'LIKELY_DUPE' | 'LIKELY_OFFICE_MAINLINE' | 'UNCERTAIN'

export interface ClusterMember {
  id: string
  firstName: string
  lastName: string
  email: string
  source: string | null
  createdAt: Date
  hasUserAccount: boolean
  /** Σ of all incoming FK refs across the 14 tracked relations. */
  refCount: number
}

export interface ClassifiedCluster {
  key: string
  members: ClusterMember[]
  classification: ClusterClass
  /** Pre-selected survivor (most refs / portal / source / oldest).
   *  Null when classification === LIKELY_OFFICE_MAINLINE — no merge
   *  recommended. */
  survivorId: string | null
  /** Brief human-readable why-this-classification, surfaced in the
   *  review UI so the rep doesn't have to re-derive. */
  rationale: string
}

function normLast(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Strip parenthetical asides like "(Sawhorse Email)" — the same
 *  human often gets multiple rows tagged with their employer in
 *  parens, and we don't want that noise to defeat the last-name
 *  equality test. */
function normFirstStripParens(s: string): string {
  return s
    .replace(/\(.*?\)/g, '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function pickSurvivor(members: ClusterMember[]): ClusterMember {
  // Priority chain: refs → portal → source → oldest.
  const sorted = [...members].sort((a, b) => {
    if (a.refCount !== b.refCount) return b.refCount - a.refCount
    if (a.hasUserAccount !== b.hasUserAccount) return a.hasUserAccount ? -1 : 1
    const aHasSource = a.source != null
    const bHasSource = b.source != null
    if (aHasSource !== bHasSource) return aHasSource ? -1 : 1
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
  return sorted[0]
}

export function classifyCluster(args: {
  key: string
  members: ClusterMember[]
}): ClassifiedCluster {
  const { key, members } = args
  if (members.length < 2) {
    return {
      key,
      members,
      classification: 'UNCERTAIN',
      survivorId: null,
      rationale: 'fewer than 2 members — not a cluster',
    }
  }

  const lastNames = new Set(members.map((m) => normLast(m.lastName)))
  // Treat "." and "" as the same null bucket — they're both
  // placeholders the capture pipeline writes when the signature
  // didn't yield a last name.
  lastNames.delete('')
  lastNames.delete('.')

  const distinctLastNames = lastNames.size

  if (distinctLastNames <= 1) {
    // All same last name (or all null-last-name) → likely dupe.
    return {
      key,
      members,
      classification: 'LIKELY_DUPE',
      survivorId: pickSurvivor(members).id,
      rationale: distinctLastNames === 0
        ? 'all members lack a last name; same phone — treat as dupe candidate'
        : `all members share last name "${[...lastNames][0]}"; same phone — likely same human across emails`,
    }
  }

  if (distinctLastNames >= 3) {
    // 3+ distinct last names with a shared number is almost always
    // an office reception line.
    return {
      key,
      members,
      classification: 'LIKELY_OFFICE_MAINLINE',
      survivorId: null,
      rationale: `${distinctLastNames} distinct last names — looks like a shared office mainline, do not merge`,
    }
  }

  // Exactly 2 distinct last names — could be either:
  //   - one human with two surnames (maiden + married, hyphenation
  //     variants), if the first names also align
  //   - two coworkers on a small team
  // Defer to first-name alignment as the tiebreaker.
  const firstNames = new Set(members.map((m) => normFirstStripParens(m.firstName)))
  firstNames.delete('')
  if (firstNames.size === 1) {
    return {
      key,
      members,
      classification: 'LIKELY_DUPE',
      survivorId: pickSurvivor(members).id,
      rationale: `2 last-name variants but a single first name — surname change/variant pattern, likely same human`,
    }
  }
  return {
    key,
    members,
    classification: 'UNCERTAIN',
    survivorId: pickSurvivor(members).id,
    rationale: `2 distinct last names AND ${firstNames.size} distinct first names — needs human review`,
  }
}

/** Sort key for review queue: LIKELY_DUPE first, UNCERTAIN second,
 *  LIKELY_OFFICE_MAINLINE last; within each group, larger clusters
 *  first (more leverage per decision). */
export function reviewQueueOrder(a: ClassifiedCluster, b: ClassifiedCluster): number {
  const rank = (c: ClassifiedCluster) =>
    c.classification === 'LIKELY_DUPE' ? 0
    : c.classification === 'UNCERTAIN' ? 1
    : 2
  if (rank(a) !== rank(b)) return rank(a) - rank(b)
  return b.members.length - a.members.length
}
