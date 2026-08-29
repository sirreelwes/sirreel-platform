/**
 * Phone-cluster pre-classification — sorts candidate dupe clusters
 * into "likely dupe" vs "likely office mainline" so the reviewer
 * isn't wading through 40% noise unsorted.
 *
 * Heuristic (validated against the STEP-0 report on prod):
 *   - Same phone + every member shares the same normalized last name
 *     → LIKELY_DUPE (e.g. "Krystin Braverman" x4 across job emails)
 *   - Same phone + members have ≥3 distinct surnames
 *     → LIKELY_OFFICE_MAINLINE (e.g. Castex Rentals reception line:
 *       Alex, Carissa, Unknown, Laura)
 *   - Mixed signal (same given name but different surnames; or
 *     surname variants like "Walker" vs "Elaine Walker") → UNCERTAIN
 *
 * "Surname" here means surnameOf(), NOT the lastName column — see its
 * comment. More than half of this table keeps the surname inside firstName,
 * and reading the column alone is what made three colleagues on one office
 * line look like one person.
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

/**
 * The parenthetical strip is NOT cosmetic. Reps disambiguate a person's
 * several rows by tagging the employer or mailbox — "Baldino (LD)",
 * "Baldino (Gmail)", "Baldino (Normal)" — and which field the tag lands in
 * depends only on how the name was typed. Leaving it in made one Anthony
 * Baldino read as three distinct surnames, i.e. an office mainline.
 * normFirstStripParens has always stripped it; this must match.
 */
function normLast(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
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

/**
 * The surname signal, wherever it actually lives.
 *
 * `lastName` is a placeholder ("" or ".") on 2,908 of 5,187 people — the
 * capture pipeline routinely puts the whole name in `firstName` and a dot in
 * `lastName`. Reading `lastName` alone is therefore silent for more than half
 * the table, and the classifier used to delete those blanks from the surname
 * set. That turned "we don't know this person's surname" into "these people
 * share a surname", which is the opposite conclusion.
 *
 * It mislabelled real people. Three unrelated staff on the Dust Studios
 * reception line — Sophia Acosta, Ramses Pacheco, Jeanette Bucci — came back
 * LIKELY_DUPE with the rationale `all members share last name "bucci"`, which
 * is not true of anyone but Bucci: the other two had their surname deleted
 * from the set. That cluster is one merge click from destroying two contacts.
 *
 * So: fall back to the last token of `firstName` when `lastName` is a
 * placeholder. Still empty (a mononym like "Taylor") means genuinely unknown,
 * and the caller treats that as no signal rather than as agreement.
 */
export function surnameOf(m: { firstName: string; lastName: string }): string {
  const last = normLast(m.lastName)
  if (last) return last
  const tokens = normFirstStripParens(m.firstName).split(' ').filter(Boolean)
  return tokens.length > 1 ? tokens[tokens.length - 1] : ''
}

/** The GIVEN name — first token only. Used as the tiebreaker when two
 *  surnames disagree, where the whole `firstName` field would compare
 *  "rob newcome" against "rob newcombe" and call one human two. */
export function givenNameOf(m: { firstName: string }): string {
  return normFirstStripParens(m.firstName).split(' ').filter(Boolean)[0] ?? ''
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
  /** How the cluster was formed. NAME gets its own branch — see below. */
  method?: 'EMAIL' | 'PHONE' | 'NAME'
  /** For NAME clusters: ids that ALSO share a phone or email with the group,
   *  i.e. whose membership rests on more than the name. */
  corroboratedIds?: ReadonlySet<string>
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

  // ── NAME clusters ────────────────────────────────────────────────────
  // These members were grouped BECAUSE their names are identical, so running
  // the surname test on them is circular — it would return LIKELY_DUPE for
  // every one of them by construction, which is an assertion the evidence
  // cannot support. Two people really are called Maria Fernandez.
  //
  // So a name cluster is never better than UNCERTAIN. It still earns its
  // place in the queue: it is the only method that can see a person whose
  // rows share no phone and no mailbox, which is the normal shape for a
  // production freelancer who has changed employers three times. A reviewer
  // resolves these in a glance; the classifier should not pretend to.
  if (args.method === 'NAME') {
    const corroboratedIds = args.corroboratedIds ?? new Set<string>()
    // Counted over the members actually PRESENT, not over the id set —
    // suppression can drop members between the absorb pass and here, and a
    // rationale claiming "3 of 4" about a 2-row cluster is worse than none.
    const corroborated = members.filter((m) => corroboratedIds.has(m.id)).length
    const nameOnly = members.length - corroborated
    return {
      key,
      members,
      classification: 'UNCERTAIN',
      survivorId: pickSurvivor(members).id,
      rationale:
        corroborated > 0
          ? `identical name; ${corroborated} of ${members.length} also share a phone, the other ${nameOnly} match on name alone`
          : `identical name, nothing else in common — one person across several mailboxes, or two people with the same name`,
    }
  }

  const lastNames = new Set(members.map((m) => surnameOf(m)))
  // An empty surname means UNKNOWN, not "matches everyone" — dropping it from
  // the set is only safe because the zero-surname case below no longer treats
  // an empty set as agreement.
  lastNames.delete('')

  const distinctLastNames = lastNames.size
  const givenNames = new Set(members.map((m) => givenNameOf(m)))
  givenNames.delete('')

  if (distinctLastNames === 1) {
    return {
      key,
      members,
      classification: 'LIKELY_DUPE',
      survivorId: pickSurvivor(members).id,
      rationale: `all members share last name "${[...lastNames][0]}"; same phone — likely same human across emails`,
    }
  }

  if (distinctLastNames === 0) {
    // Nobody in the cluster has a surname anywhere. The given name is then
    // the ONLY evidence, so it has to carry the decision on its own: two
    // people both called "Taylor" on one line is a dupe candidate, "Merry"
    // and "Iunia" on one line is two colleagues.
    return {
      key,
      members,
      classification: givenNames.size === 1 ? 'LIKELY_DUPE' : 'UNCERTAIN',
      survivorId: pickSurvivor(members).id,
      rationale:
        givenNames.size === 1
          ? `no surname on any member, but all are "${[...givenNames][0]}"; same phone — dupe candidate`
          : `no surname on any member and ${givenNames.size} different given names — needs human review`,
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
  const firstNames = givenNames
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
