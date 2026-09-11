/**
 * Every number AHA currently recognises, with its tier and the reason —
 * the roster behind the "Who AHA recognises" section on /admin/assistant.
 *
 * Wes 2026-09-11: "Where do I manage what numbers have access to what
 * through AHA." There was no one place: staff live on the User row,
 * production contacts follow the job, drivers follow the truck's
 * assignment. This does not ADD a way to grant access — it reads the same
 * facts the live checks read, so the list and the behaviour cannot
 * disagree — and each row says where to change it.
 *
 * Tiers, in the order AHA applies them (a number in two tiers is listed
 * twice, once per reason):
 *   staff    — identifySender(): active User.phone or User.emergencyPhone.
 *              Fleet and job lookups by text.
 *   contact  — identifySender(): JobContact or booking requester on a
 *              CURRENT job (currentJobWhere: ±7 days). Their own job's
 *              details, a message to their agent, and — with the unit or
 *              VIN last 4 — that job's truck codes (phone factor).
 *   driver   — verifyAndRelease(): the checkout driver on an assignment
 *              that is ASSIGNED / CHECKED_OUT within a day of today. Truck
 *              codes for that unit with the unit or VIN last 4.
 * Everything else is the public tier: job-code verification, escalation,
 * gear setup help. There is no block list; STOP only silences outbound.
 */
import { prisma } from '@/lib/prisma'
import { phoneTail } from '@/lib/assistant/phoneFactor'
import { currentJobWhere, currentWindow } from '@/lib/assistant/senderIdentity'
import { levelForRole, levelFromGrant, type AhaLevel } from '@/lib/assistant/access'

/** grant = added by hand; blocked = taken away by hand. Both live in sr_aha_grants. */
export type RecognizedTier = 'staff' | 'contact' | 'driver' | 'grant' | 'blocked'

export interface RecognizedNumber {
  tier: RecognizedTier
  /** The access level this row resolves to (see src/lib/assistant/access.ts). */
  level: AhaLevel
  /** Ten-digit tail — what the match is actually made on. */
  tail: string
  /** The number as typed on file. */
  phone: string
  name: string
  /** Why AHA recognises it — the field it sits in. */
  reason: string
  /** What it unlocks, in words the admin page shows. */
  grants: string
  /** Where to change it. */
  manageHref: string
  manageLabel: string
  /** When contact/driver access lapses on its own, if it does. */
  until: string | null
  jobCode?: string | null
  jobName?: string | null
  unit?: string | null
  /** Set on hand-made rows so the page can revoke them. */
  grantId?: string | null
  note?: string | null
}

const CONTACT_GRANTS = 'Own job details, message to agent, and the job\'s truck codes with the unit or VIN last 4'
const DRIVER_GRANTS = 'That truck\'s gate + lockbox codes with the unit or VIN last 4'
const STAFF_GRANTS = 'Fleet and job lookups (who is on a unit, has a job come back, drivers + numbers)'
const ADMIN_GRANTS = 'Everything staff can, plus the platform memory and recent admin activity'
const BLOCKED_GRANTS = 'Nothing — told to call the office'

function grantsForLevel(level: AhaLevel): string {
  return level === 'admin' ? ADMIN_GRANTS : level === 'staff' ? STAFF_GRANTS : level === 'contact' ? CONTACT_GRANTS : level === 'blocked' ? BLOCKED_GRANTS : 'Public'
}

function display(raw: string | null | undefined): string {
  return (raw ?? '').trim()
}

function plusDays(d: Date, n: number): Date {
  const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x
}

function latest(dates: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null
  for (const d of dates) if (d && (!best || d > best)) best = d
  return best
}

export async function listRecognizedNumbers(now = new Date()): Promise<RecognizedNumber[]> {
  const rows: RecognizedNumber[] = []

  // ── Hand-made grants and blocks (the table may not exist before db push) ──
  type GrantRow = { id: string; phone: string; phoneTail: string; name: string; level: string; note: string | null; jobId: string | null }
  let grantRows: GrantRow[] = []
  try {
    grantRows = await prisma.ahaGrant.findMany({ where: { revokedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, phone: true, phoneTail: true, name: true, level: true, note: true, jobId: true } })
  } catch (err) {
    console.error('[recognizedNumbers] grants unavailable:', err)
  }
  const grantJobs = new Map<string, { jobCode: string; name: string }>()
  const jobIds = grantRows.map((g) => g.jobId).filter((x): x is string => Boolean(x))
  if (jobIds.length) {
    for (const j of await prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobCode: true, name: true } })) grantJobs.set(j.id, { jobCode: j.jobCode, name: j.name })
  }
  for (const g of grantRows) {
    const level = levelFromGrant(g.level)
    const job = g.jobId ? grantJobs.get(g.jobId) : null
    rows.push({
      tier: level === 'blocked' ? 'blocked' : 'grant', level, tail: g.phoneTail, phone: g.phone, name: g.name,
      reason: level === 'blocked' ? 'Blocked by hand on this page' : `Added by hand on this page as ${level}${job ? ` on job ${job.jobCode}` : ''}`,
      grants: grantsForLevel(level), manageHref: '/admin/assistant', manageLabel: 'Remove',
      until: null, grantId: g.id, note: g.note, jobCode: job?.jobCode ?? null, jobName: job?.name ?? null,
    })
  }
  const overridden = new Set(grantRows.map((g) => g.phoneTail))

  // ── Staff: level follows the HQ role ──
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: [{ phone: { not: null } }, { emergencyPhone: { not: null } }] },
    select: { id: true, name: true, role: true, phone: true, emergencyPhone: true },
    orderBy: { name: 'asc' },
  })
  for (const u of users) {
    const seen = new Set<string>()
    const level = levelForRole(String(u.role))
    for (const [field, raw] of [['Mobile on the emergency-contacts card', u.phone], ['Emergency phone on the emergency-contacts card', u.emergencyPhone]] as const) {
      const tail = phoneTail(raw)
      if (!tail || seen.has(tail)) continue
      seen.add(tail)
      const over = overridden.has(tail)
      rows.push({
        tier: 'staff', level: over ? 'public' : level, tail, phone: display(raw), name: u.name,
        reason: `${field} (HQ role ${String(u.role)} → ${level})${over ? ' — overridden by the hand-made row above' : ''}`,
        grants: over ? 'See the hand-made row for this number' : grantsForLevel(level),
        manageHref: '/admin/assistant', manageLabel: 'Emergency contacts, above',
        until: null,
      })
    }
  }

  // ── Production contacts on current jobs — the same query identifySender runs ──
  const { to } = currentWindow(now)
  const jobs = await prisma.job.findMany({
    where: {
      ...currentJobWhere(now),
      OR: [
        { jobContacts: { some: { person: { OR: [{ phone: { not: null } }, { mobile: { not: null } }] } } } },
        { bookings: { some: { person: { OR: [{ phone: { not: null } }, { mobile: { not: null } }] } } } },
      ],
    },
    select: {
      id: true, jobCode: true, name: true,
      jobContacts: { select: { role: true, person: { select: { id: true, firstName: true, lastName: true, phone: true, mobile: true } } } },
      bookings: {
        where: { archivedAt: null, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
        select: { endDate: true, person: { select: { id: true, firstName: true, lastName: true, phone: true, mobile: true } } },
      },
      orders: { where: { status: { notIn: ['CANCELLED', 'CLOSED'] } }, select: { endDate: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  for (const j of jobs) {
    // Access lapses 7 days after the last live order/booking date. A window
    // that already runs past the grace edge shows the edge, not a date in
    // the future that would be re-evaluated anyway.
    const lastDate = latest([...j.orders.map((o) => o.endDate), ...j.bookings.map((b) => b.endDate)])
    const until = lastDate ? plusDays(lastDate, 7) : to
    const seen = new Set<string>()
    const push = (p: { firstName: string | null; lastName: string | null; phone: string | null; mobile: string | null }, role: string, field: string) => {
      for (const [label, raw] of [['phone', p.phone], ['mobile', p.mobile]] as const) {
        const tail = phoneTail(raw)
        if (!tail || seen.has(`${tail}:${role}`)) continue
        seen.add(`${tail}:${role}`)
        rows.push({
          tier: 'contact', level: overridden.has(tail) ? 'public' : 'contact', tail, phone: display(raw),
          name: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || 'Contact',
          reason: `${field} (${role}) — ${label} on their contact record`, grants: CONTACT_GRANTS,
          manageHref: `/jobs/${j.id}`, manageLabel: `Job ${j.jobCode} contacts`,
          until: until.toISOString(), jobCode: j.jobCode, jobName: j.name,
        })
      }
    }
    for (const jc of j.jobContacts) push(jc.person, String(jc.role), 'Job contact')
    for (const b of j.bookings) if (b.person) push(b.person, 'REQUESTER', 'Booking requester')
  }

  // ── Checkout drivers on live assignments — the same window verifyAndRelease uses ──
  const GRACE_DAYS = 1
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0)
  const assignments = await prisma.bookingAssignment.findMany({
    where: {
      status: { in: ['ASSIGNED', 'CHECKED_OUT'] },
      startDate: { lte: plusDays(today, GRACE_DAYS) },
      endDate: { gte: plusDays(today, -GRACE_DAYS) },
      bookingItem: { booking: { status: { notIn: ['CANCELLED', 'ARCHIVED'] }, archivedAt: null } },
      checkoutRecords: { some: { driver: { phone: { not: null } } } },
    },
    select: {
      endDate: true,
      asset: { select: { unitName: true } },
      bookingItem: { select: { booking: { select: { job: { select: { id: true, jobCode: true, name: true } } } } } },
      checkoutRecords: { select: { driver: { select: { firstName: true, lastName: true, phone: true } } } },
    },
    orderBy: { endDate: 'asc' },
    take: 300,
  })
  for (const a of assignments) {
    const job = a.bookingItem.booking.job
    const seen = new Set<string>()
    for (const cr of a.checkoutRecords) {
      const tail = phoneTail(cr.driver?.phone)
      if (!cr.driver || !tail || seen.has(tail)) continue
      seen.add(tail)
      rows.push({
        tier: 'driver', level: overridden.has(tail) ? 'public' : 'public', tail, phone: display(cr.driver.phone),
        name: `${cr.driver.firstName} ${cr.driver.lastName}`.trim(),
        reason: `Checkout driver on ${a.asset.unitName}`, grants: DRIVER_GRANTS,
        manageHref: job ? `/jobs/${job.id}` : '/drivers', manageLabel: job ? `Job ${job.jobCode} check-out` : 'Driver record',
        until: plusDays(a.endDate, GRACE_DAYS).toISOString(),
        jobCode: job?.jobCode ?? null, jobName: job?.name ?? null, unit: a.asset.unitName,
      })
    }
  }

  return rows
}
