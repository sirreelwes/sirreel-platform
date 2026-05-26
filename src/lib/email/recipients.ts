/**
 * Canonical recipient-ranking logic for every client-facing email send.
 *
 * Every place that picks the To: address — quote send, Mode A follow-up
 * send, the public resend-link endpoint, the new preview endpoints —
 * imports this. There must be exactly one ranking function in the
 * repo. Inline copies in route files are a drift risk: a tweak in one
 * place silently diverges from where the agent's "Send" actually goes.
 *
 * Rank order (lowest number wins):
 *   0  PRODUCER role
 *   1  isPrimary flag on any JobContact
 *   2  PM role
 *   3  PC role
 *   4  any other role
 *   5  Order.jobContact override (only used when nothing else matched)
 *
 * The id returned in RankedRecipient is `Person.id`, suitable for use
 * as `contactId` on PortalAccess writes.
 */

export interface RankedRecipient {
  /** Person.id — usable as PortalAccess.contactId. */
  id: string
  name: string
  email: string
  role: string | null
  isPrimary: boolean
}

/** Shape of JobContact rows joined with their Person, as the order
 *  detail / send routes select them. */
export interface JobContactJoined {
  role: string
  isPrimary: boolean
  person: {
    id: string
    firstName: string
    lastName: string
    email: string
  }
}

/** Shape of Order.jobContact (an override that points directly at a
 *  Person — schema column is misleadingly named, it's a Person FK). */
export interface OrderJobContactOverride {
  id: string
  firstName: string
  lastName: string
  email: string
}

/**
 * Returns the full ranked list (most-canonical first). Empty when the
 * order has neither JobContacts nor an Order.jobContact override; the
 * caller should refuse the send in that case.
 */
export function rankRecipients(
  job: { jobContacts: JobContactJoined[] } | null,
  jobContact: OrderJobContactOverride | null,
): RankedRecipient[] {
  const all: RankedRecipient[] = []
  const seen = new Set<string>()
  const push = (
    id: string,
    name: string,
    email: string,
    role: string | null,
    isPrimary: boolean,
  ) => {
    if (!id || !email || seen.has(id)) return
    seen.add(id)
    all.push({ id, name, email, role, isPrimary })
  }
  for (const jc of job?.jobContacts ?? []) {
    push(
      jc.person.id,
      `${jc.person.firstName} ${jc.person.lastName}`.trim(),
      jc.person.email,
      jc.role,
      !!jc.isPrimary,
    )
  }
  if (jobContact) {
    push(
      jobContact.id,
      `${jobContact.firstName} ${jobContact.lastName}`.trim(),
      jobContact.email,
      null,
      false,
    )
  }
  const rank = (r: RankedRecipient): number => {
    if (r.role === 'PRODUCER') return 0
    if (r.isPrimary) return 1
    if (r.role === 'PM') return 2
    if (r.role === 'PC') return 3
    if (r.role) return 4
    return 5
  }
  all.sort((a, b) => rank(a) - rank(b))
  return all
}

/** Convenience helper — returns the canonical recipient or null. */
export function pickCanonicalRecipient(
  job: { jobContacts: JobContactJoined[] } | null,
  jobContact: OrderJobContactOverride | null,
): RankedRecipient | null {
  const ranked = rankRecipients(job, jobContact)
  return ranked[0] ?? null
}
