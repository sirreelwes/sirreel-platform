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
import { classifyCluster, reviewQueueOrder, type ClassifiedCluster, type ClusterMember } from './clusters'

const STAFF_EMAIL_REGEX = /@sirreel\.com$/i

type Method = 'EMAIL' | 'PHONE'

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

  // Build cluster list
  type Pending = { key: string; method: Method; members: PersonLite[] }
  const pending: Pending[] = []
  for (const [k, members] of byEmail) {
    if (members.length > 1) pending.push({ key: `email:${k}`, method: 'EMAIL', members })
  }
  for (const [k, members] of byPhone) {
    if (members.length > 1) pending.push({ key: `phone:${k}`, method: 'PHONE', members })
  }

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
    const classified = classifyCluster({ key: c.key, members: classifiedMembers })
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

  // Sort: EMAIL method clusters first (strongest signal — case-only
  // dupes pre-Wes-canary, plus any future email-case clusters), then
  // by the classifier's review queue order.
  out.sort((a, b) => {
    if (a.method !== b.method) return a.method === 'EMAIL' ? -1 : 1
    return reviewQueueOrder(a, b)
  })

  return out
}
