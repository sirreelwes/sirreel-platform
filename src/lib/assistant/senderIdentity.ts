/**
 * Who is texting AHA — decided by the SERVER from the sender's number, never
 * by the model. The identity picks which tools the model is even offered:
 *
 *   staff    — an active HQ user whose mobile (User.phone) or emergency
 *              phone matches. Wes 2026-09-10: "Jose, Dani, Wes, Oliver,
 *              Hugo, Albert … approved to find out job information" — who is
 *              on Cube 27, has a job come back. Gets the fleet/job lookups.
 *   contact  — a production contact (JobContact, or the booking's requester)
 *              on a CURRENT job. Wes: "wide leeway to get help from AHA"
 *              during an active job. Gets their own job's details and can
 *              leave a message for their agent without it being an
 *              emergency.
 *
 * "Current job" = not archived, not LOST/WRAPPED, and with an order or a
 * live booking whose window is within the grace band around today — the
 * same "live" notion the code-release check uses, so a contact who is
 * current for codes is current here too.
 *
 * Numbers are matched by ten-digit tail (src/lib/assistant/phoneFactor.ts),
 * so "(818) 515-2389" on file matches +18185152389 from the carrier.
 */
import { prisma } from '@/lib/prisma'
import { phoneOnFile, phoneTail } from '@/lib/assistant/phoneFactor'
import { firstNameOf } from '@/lib/assistant/greeting'
import { atLeast, levelFromGrant, resolveLevel, type AhaLevel } from '@/lib/assistant/access'

/** Days either side of today an order/booking window may sit and still count as current. */
const CURRENT_GRACE_DAYS = 7

export interface SenderIdentity {
  /** Non-null at staff and admin level (lookups gate on it). */
  staff: { userId: string; name: string; role: string } | null
  contactJobs: Array<{ jobId: string; jobCode: string; name: string; role: string | null }>
  /** What to call them — the staff user's or the matched contact's first name. */
  firstName: string | null
  /** The one number that decides the tools: see src/lib/assistant/access.ts. */
  level: AhaLevel
  /** The hand-made grant that set the level, when one did. */
  grant: { id: string; name: string; level: AhaLevel; note: string | null } | null
}

export const NO_IDENTITY: SenderIdentity = { staff: null, contactJobs: [], firstName: null, level: 'public', grant: null }

/** Identity for a signed-in HQ user (the authenticated chat on /admin/assistant). Level follows the role. */
export function identityForUser(user: { id: string; name: string; role: string }): SenderIdentity {
  const level = resolveLevel({ userRole: user.role })
  return {
    staff: atLeast(level, 'staff') ? { userId: user.id, name: user.name, role: String(user.role) } : null,
    contactJobs: [],
    firstName: firstNameOf(user.name),
    level,
    grant: null,
  }
}

/** The active hand-made grant for a number, if the table exists yet. */
async function activeGrant(tail: string) {
  try {
    const g = await prisma.ahaGrant.findFirst({
      where: { phoneTail: tail, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, level: true, note: true, jobId: true },
    })
    return g ? { id: g.id, name: g.name, level: levelFromGrant(g.level), note: g.note, jobId: g.jobId } : null
  } catch (err) {
    // Before `prisma db push` the table is missing; AHA keeps working on the
    // derived tiers alone rather than failing every text.
    console.error('[senderIdentity] grant lookup failed:', err)
    return null
  }
}

export function currentWindow(now = new Date()): { from: Date; to: Date } {
  const from = new Date(now); from.setUTCHours(0, 0, 0, 0); from.setUTCDate(from.getUTCDate() - CURRENT_GRACE_DAYS)
  const to = new Date(now); to.setUTCHours(0, 0, 0, 0); to.setUTCDate(to.getUTCDate() + CURRENT_GRACE_DAYS)
  return { from, to }
}

/** The Prisma filter for a job that is current right now. */
export function currentJobWhere(now = new Date()) {
  const { from, to } = currentWindow(now)
  return {
    archivedAt: null,
    status: { notIn: ['LOST', 'WRAPPED'] as Array<'LOST' | 'WRAPPED'> },
    OR: [
      { orders: { some: { status: { notIn: ['CANCELLED', 'CLOSED'] as Array<'CANCELLED' | 'CLOSED'> }, startDate: { lte: to }, endDate: { gte: from } } } },
      { bookings: { some: { status: { notIn: ['CANCELLED', 'ARCHIVED'] as Array<'CANCELLED' | 'ARCHIVED'> }, archivedAt: null, startDate: { lte: to }, endDate: { gte: from } } } },
    ],
  }
}

export async function identifySender(senderPhone: string | null | undefined): Promise<SenderIdentity> {
  const tail = phoneTail(senderPhone)
  if (!tail) return NO_IDENTITY

  const grant = await activeGrant(tail)
  // Blocked is decided before anything else is even looked up.
  if (grant?.level === 'blocked') {
    return { staff: null, contactJobs: [], firstName: firstNameOf(grant.name), level: 'blocked', grant: { id: grant.id, name: grant.name, level: 'blocked', note: grant.note } }
  }

  // Staff: the fleet is small enough to scan in memory; the phone columns
  // are free-text and a suffix match is not indexable anyway.
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: [{ phone: { not: null } }, { emergencyPhone: { not: null } }] },
    select: { id: true, name: true, role: true, phone: true, emergencyPhone: true },
  })
  const staffHit = users.find((u) => phoneOnFile(tail, [u.phone, u.emergencyPhone])) ?? null

  // Production contacts on current jobs: JobContact rows and the booking's
  // requester. Both are Person rows, matched on phone or mobile.
  const jobs = await prisma.job.findMany({
    where: {
      ...currentJobWhere(),
      OR: [
        { jobContacts: { some: { person: { OR: [{ phone: { not: null } }, { mobile: { not: null } }] } } } },
        { bookings: { some: { person: { OR: [{ phone: { not: null } }, { mobile: { not: null } }] } } } },
      ],
    },
    select: {
      id: true, jobCode: true, name: true,
      jobContacts: { select: { role: true, person: { select: { firstName: true, phone: true, mobile: true } } } },
      bookings: { where: { archivedAt: null, status: { notIn: ['CANCELLED', 'ARCHIVED'] } }, select: { person: { select: { firstName: true, phone: true, mobile: true } } } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  const contactJobs: SenderIdentity['contactJobs'] = []
  let contactFirstName: string | null = null
  for (const j of jobs) {
    const jc = j.jobContacts.find((c) => phoneOnFile(tail, [c.person.phone, c.person.mobile]))
    const requester = jc ? null : j.bookings.find((b) => phoneOnFile(tail, [b.person.phone, b.person.mobile]))
    if (jc || requester) {
      contactJobs.push({ jobId: j.id, jobCode: j.jobCode, name: j.name, role: jc ? String(jc.role) : 'REQUESTER' })
      contactFirstName ??= firstNameOf(jc?.person.firstName, requester?.person.firstName)
    }
  }

  // A hand-made CONTACT grant names the job it is a contact on.
  if (grant?.level === 'contact' && grant.jobId && !contactJobs.some((j) => j.jobId === grant.jobId)) {
    const j = await prisma.job.findUnique({ where: { id: grant.jobId }, select: { id: true, jobCode: true, name: true } }).catch(() => null)
    if (j) contactJobs.push({ jobId: j.id, jobCode: j.jobCode, name: j.name, role: 'GRANT' })
  }

  const level = resolveLevel({ grantLevel: grant?.level ?? null, userRole: staffHit?.role ?? null, isContact: contactJobs.length > 0 })
  // Staff is non-null exactly when the level allows staff tools: an HQ user
  // hit, or a hand-made STAFF/ADMIN grant standing in for one. A CONTACT
  // grant on an HQ user deliberately takes the staff tools away.
  const staff = atLeast(level, 'staff')
    ? staffHit
      ? { userId: staffHit.id, name: staffHit.name, role: String(staffHit.role) }
      : grant
        ? { userId: `grant:${grant.id}`, name: grant.name, role: grant.level.toUpperCase() }
        : null
    : null
  return {
    staff,
    contactJobs: atLeast(level, 'contact') ? contactJobs : [],
    firstName: firstNameOf(staffHit?.name) ?? firstNameOf(grant?.name) ?? contactFirstName,
    level,
    grant: grant ? { id: grant.id, name: grant.name, level: grant.level, note: grant.note } : null,
  }
}

/** The one-line hint the prompt gets. Names and roles only. */
export function describeSender(id: SenderIdentity): string | null {
  if (id.level === 'blocked') return null
  if (id.staff) return `SirReel STAFF at ${id.level.toUpperCase()} level: ${id.staff.name} (${id.staff.role}).`
  if (id.contactJobs.length) {
    const list = id.contactJobs.slice(0, 3).map((j) => `${j.name} (${j.jobCode}, ${j.role ?? 'contact'})`).join('; ')
    return `A PRODUCTION CONTACT on a current job: ${list}.`
  }
  return null
}
