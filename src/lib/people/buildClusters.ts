/**
 * Cluster builder — runs the same three methods the STEP-0 dedup
 * report used (email-case, phone digits-only, name+shared-company),
 * enriches each member with FK ref counts, classifies via
 * src/lib/people/clusters.ts, and returns the queue ready for the
 * /admin/dedup UI.
 *
 * Filters dedupSuppressedAt rows out of clusters by default — a
 * cluster the reviewer already marked "shared office line" should
 * not reappear. Pass `includeSuppressed: true` to surface them in
 * the suppressed-clusters view.
 *
 * Server-side only — pulls every Person row. Not cheap. The /admin
 * UI calls this on demand; not on every page load.
 */
import { prisma } from '@/lib/prisma'
import {
  classifyCluster, reviewQueueOrder, surnameOf, givenNameOf,
  type ClassifiedCluster, type ClusterMember,
} from './clusters'

const STAFF_EMAIL_REGEX = /@sirreel\.com$/i

type Method = 'EMAIL' | 'PHONE' | 'NAME'

export interface ClusterWithRefs extends ClassifiedCluster {
  method: Method
  /** Per-member field values for the side-by-side diff UI. */
  rows: Array<{
    id: string
    firstName: string
    lastName: string
    email: string
    phone: string | null
    mobile: string | null
    role: string
    tier: string
    source: string | null
    rawTitle: string | null
    lastKnownProject: string | null
    notes: string | null
    createdAt: string
    refCount: number
    hasUserAccount: boolean
  }>
}

function digitsOnly(p: string | null | undefined): string {
  return (p ?? '').replace(/\D+/g, '')
}

interface PersonLite {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  mobile: string | null
  role: string
  tier: string
  source: string | null
  rawTitle: string | null
  lastKnownProject: string | null
  notes: string | null
  createdAt: Date
  dedupSuppressedAt: Date | null
}

async function fkRefsBatch(personIds: string[]): Promise<Map<string, { refCount: number; hasUserAccount: boolean }>> {
  const out = new Map<string, { refCount: number; hasUserAccount: boolean }>()
  for (const id of personIds) out.set(id, { refCount: 0, hasUserAccount: false })
  const inFilter = { in: personIds }
  const [
    bookings, refBookings, jobContacts, orderContacts, affiliations,
    outreach, activities, emails, inquiries, inquiryCaptures, personSessions,
    portalAccesses, users, worksWithBack,
  ] = await Promise.all([
    prisma.booking.groupBy({ by: ['personId'], where: { personId: inFilter }, _count: true }),
    prisma.booking.groupBy({ by: ['referredById'], where: { referredById: inFilter }, _count: true }),
    prisma.jobContact.groupBy({ by: ['personId'], where: { personId: inFilter }, _count: true }),
    prisma.order.groupBy({ by: ['jobContactId'], where: { jobContactId: inFilter }, _count: true }),
    prisma.affiliation.groupBy({ by: ['personId'], where: { personId: inFilter }, _count: true }),
    prisma.outreachActivity.groupBy({ by: ['personId'], where: { personId: inFilter }, _count: true }),
    prisma.activity.groupBy({ by: ['personId'], where: { personId: inFilter }, _count: true }),
    prisma.emailMessage.groupBy({ by: ['personId'], where: { personId: inFilter }, _count: true }),
    prisma.inquiry.groupBy({ by: ['personId'], where: { personId: inFilter }, _count: true }),
    prisma.inquiryCapture.groupBy({ by: ['personId'], where: { personId: inFilter }, _count: true }),
    prisma.personSession.groupBy({ by: ['personId'], where: { personId: inFilter }, _count: true }),
    prisma.portalAccess.groupBy({ by: ['contactId'], where: { contactId: inFilter }, _count: true }),
    prisma.user.findMany({ where: { personId: inFilter }, select: { personId: true } }),
    prisma.person.groupBy({ by: ['worksWithId'], where: { worksWithId: inFilter }, _count: true }),
  ])
  const bump = (id: string | null, n: number) => { if (id && out.has(id)) out.get(id)!.refCount += n }
  for (const r of bookings) bump(r.personId, r._count)
  for (const r of refBookings) bump(r.referredById, r._count)
  for (const r of jobContacts) bump(r.personId, r._count)
  for (const r of orderContacts) bump(r.jobContactId, r._count)
  for (const r of affiliations) bump(r.personId, r._count)
  for (const r of outreach) bump(r.personId, r._count)
  for (const r of activities) bump(r.personId, r._count)
  for (const r of emails) bump(r.personId, r._count)
  for (const r of inquiries) bump(r.personId, r._count)
  for (const r of inquiryCaptures) bump(r.personId, r._count)
  for (const r of personSessions) bump(r.personId, r._count)
  for (const r of portalAccesses) bump(r.contactId, r._count)
  for (const r of users) { if (r.personId && out.has(r.personId)) { const v = out.get(r.personId)!; v.hasUserAccount = true; v.refCount += 1 } }
  for (const r of worksWithBack) bump(r.worksWithId, r._count)
  return out
}

function toMember(p: PersonLite, refs: { refCount: number; hasUserAccount: boolean }): ClusterMember {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    source: p.source,
    createdAt: p.createdAt,
    hasUserAccount: refs.hasUserAccount,
    refCount: refs.refCount,
  }
}

export async function buildClusters(args: {
  includeSuppressed?: boolean
} = {}): Promise<ClusterWithRefs[]> {
  const includeSuppressed = !!args.includeSuppressed

  // Pull every Person — small enough today (~4,600). If this ever
  // gets big, partition by (suppressedAt IS NULL) here.
  const all: PersonLite[] = await prisma.person.findMany({
    select: {
      id: true, firstName: true, lastName: true, email: true,
      phone: true, mobile: true, role: true, tier: true, source: true,
      rawTitle: true, lastKnownProject: true, notes: true,
      createdAt: true, dedupSuppressedAt: true,
    },
  })

  // Hide staff @sirreel.com from the clustering — they're internal,
  // never client relationships, and they live in their own rows that
  // shouldn't be merge candidates from this surface.
  const visible = all.filter((p) => !STAFF_EMAIL_REGEX.test(p.email))

  // ── Email-case method (Method A) ────────────────────────────────
  const byEmail = new Map<string, PersonLite[]>()
  for (const p of visible) {
    const k = p.email.trim().toLowerCase()
    if (!k) continue
    const arr = byEmail.get(k) ?? []
    arr.push(p)
    byEmail.set(k, arr)
  }

  // ── Phone method (Method C) ─────────────────────────────────────
  const byPhone = new Map<string, PersonLite[]>()
  for (const p of visible) {
    const seen = new Set<string>()
    for (const d of [digitsOnly(p.mobile), digitsOnly(p.phone)]) {
      if (d.length < 7) continue
      if (seen.has(d)) continue
      seen.add(d)
      const arr = byPhone.get(d) ?? []
      if (!arr.find((x) => x.id === p.id)) arr.push(p)
      byPhone.set(d, arr)
    }
  }

  // ── Name method (Method B) ──────────────────────────────────────
  // The gap the other two methods cannot see: a person whose rows share
  // neither a mailbox nor a number. That is the NORMAL shape here — a
  // freelance producer accumulates a row per employer plus a personal
  // one, and only some of those signatures carried a phone. Abi Perl had
  // three rows and the phone method reached two of them.
  //
  // Keyed on given name + surname via the same accessors the classifier
  // uses, so a row keeping its surname inside firstName still matches one
  // that uses the column. Both parts must be present: a mononym ("Taylor")
  // is far too weak to group strangers on, and 130 rows have no surname
  // anywhere.
  const byName = new Map<string, PersonLite[]>()
  for (const p of visible) {
    const given = givenNameOf(p)
    const surname = surnameOf(p)
    if (!given || !surname) continue
    const k = `${given} ${surname}`
    const arr = byName.get(k) ?? []
    arr.push(p)
    byName.set(k, arr)
  }

  // Build cluster list
  type Pending = { key: string; method: Method; members: PersonLite[]; corroboratedIds?: Set<string> }
  const pending: Pending[] = []
  for (const [k, members] of byEmail) {
    if (members.length > 1) pending.push({ key: `email:${k}`, method: 'EMAIL', members })
  }
  for (const [k, members] of byPhone) {
    if (members.length > 1) pending.push({ key: `phone:${k}`, method: 'PHONE', members })
  }

  // ── Absorb, so one person is one row of work ────────────────────
  // 167 of the 365 name groups are already covered by a phone cluster.
  // Emitting both would nearly double the queue with pairs the reviewer
  // has to recognise as the same decision seen twice.
  //
  // A name group ABSORBS a phone/email cluster when that cluster's members
  // are a strict subset of it: the name group is the same finding plus the
  // rows the phone couldn't reach, so it replaces it, and the absorbed ids
  // are carried through as corroboration.
  //
  // Two deliberate refusals:
  //  · Exactly equal → the name adds nothing, so the stronger cluster stands
  //    and the name group is dropped. (Otherwise every phone cluster would
  //    be downgraded to a name cluster's UNCERTAIN for no new information.)
  //  · TWO OR MORE subsets → left alone. Two proven groups inside one name
  //    means two people who share a name and each have their own corroborated
  //    rows; fusing them would assert exactly the thing that is in doubt, and
  //    would trade two confident clusters for one vague one.
  //
  // A name group that is CONTAINED IN a phone cluster (rather than containing
  // one) is not absorbed either way, so those two clusters overlap in the
  // queue. That is deliberate and worth keeping: it is how the name method
  // rescues duplicates buried in an office line. Adam Navarro has two rows;
  // the phone method could only see him as half of "Mike Simeone | Adam
  // Navarro" — two colleagues on the cfg.rentals number, correctly UNCERTAIN
  // and un-mergeable. The name cluster pulls his own two rows out as their
  // own finding. Same for Medhat Isaac and Dany Lugo. Collapsing these
  // overlaps would re-bury exactly the work this method exists to surface.
  const absorbed = new Set<Pending>()
  const nameClusters: Pending[] = []
  for (const [k, members] of byName) {
    if (members.length < 2) continue
    const ids = new Set(members.map((m) => m.id))
    const subsets = pending.filter((c) => c.members.every((m) => ids.has(m.id)))
    if (subsets.length > 1) continue
    const only = subsets[0]
    if (only && only.members.length === members.length) continue
    if (only) absorbed.add(only)
    nameClusters.push({
      key: `name:${k}`,
      method: 'NAME',
      members,
      corroboratedIds: new Set(only ? only.members.map((m) => m.id) : []),
    })
  }
  for (const c of absorbed) pending.splice(pending.indexOf(c), 1)
  pending.push(...nameClusters)

  // Suppression filter — drop the cluster entirely if ALL members are
  // suppressed; otherwise drop the suppressed members and keep what's
  // left (a partial cluster can still have a real dupe pair).
  const filtered = pending
    .map((c) => ({
      ...c,
      members: includeSuppressed ? c.members : c.members.filter((m) => m.dedupSuppressedAt == null),
    }))
    .filter((c) => c.members.length > 1)

  // Pull ref counts once for the union of all member ids.
  const memberIds = Array.from(new Set(filtered.flatMap((c) => c.members.map((m) => m.id))))
  const refs = memberIds.length > 0 ? await fkRefsBatch(memberIds) : new Map()

  // Classify each cluster
  const out: ClusterWithRefs[] = []
  for (const c of filtered) {
    const classifiedMembers = c.members.map((m) => toMember(m, refs.get(m.id) ?? { refCount: 0, hasUserAccount: false }))
    const classified = classifyCluster({
      key: c.key,
      members: classifiedMembers,
      method: c.method,
      corroboratedIds: c.corroboratedIds,
    })
    out.push({
      ...classified,
      method: c.method,
      rows: c.members.map((m) => ({
        id: m.id, firstName: m.firstName, lastName: m.lastName, email: m.email,
        phone: m.phone, mobile: m.mobile, role: m.role, tier: m.tier,
        source: m.source, rawTitle: m.rawTitle, lastKnownProject: m.lastKnownProject,
        notes: m.notes, createdAt: m.createdAt.toISOString(),
        refCount: (refs.get(m.id)?.refCount ?? 0),
        hasUserAccount: refs.get(m.id)?.hasUserAccount ?? false,
      })),
    })
  }

  // Sort: by strength of the signal that formed the cluster — EMAIL
  // (case-only dupes) then PHONE then NAME — and within a method by the
  // classifier's review queue order.
  //
  // Ranked rather than `a.method === 'EMAIL' ? -1 : 1`, which was a valid
  // comparator only while there were exactly two methods: with three it
  // returns 1 for both PHONE-vs-NAME and NAME-vs-PHONE, so the sort is
  // inconsistent and the resulting order is whatever the engine does with
  // contradictory answers.
  const methodRank = (m: Method) => (m === 'EMAIL' ? 0 : m === 'PHONE' ? 1 : 2)
  out.sort((a, b) => {
    const r = methodRank(a.method) - methodRank(b.method)
    return r !== 0 ? r : reviewQueueOrder(a, b)
  })

  return out
}
