/**
 * Read-only lookups AHA can run for an identified sender. Offered to the
 * model ONLY after src/lib/assistant/senderIdentity.ts has matched the
 * number (see runAssistant); each function also takes the identity and
 * refuses on its own, so a tool call can never widen what a number may see.
 *
 *   staffLookupUnit  — "who's on Cube 27?"  (staff)
 *   staffLookupJob   — "has Forgotten Island come back?"  (staff)
 *   contactJobInfo   — "what's on my booking / when is pickup?"  (contact)
 *
 * Everything returned is names, numbers, dates and statuses — never a gate
 * or lockbox code (those stay behind verify_and_release_code) and never
 * pricing or balances. Dates are yyyy-mm-dd; the model formats them.
 */
import { prisma } from '@/lib/prisma'
import { currentJobWhere, currentWindow, type SenderIdentity } from '@/lib/assistant/senderIdentity'

const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : null)
const person = (p: { firstName: string | null; lastName: string | null } | null | undefined) =>
  p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || null : null

/** Assignments in the current window, shaped once for all three lookups. */
const ASSIGNMENT_SELECT = {
  status: true, startDate: true, endDate: true,
  asset: { select: { id: true, unitName: true, category: { select: { name: true } } } },
  bookingItem: { select: { booking: { select: { id: true, jobName: true, jobId: true, deliveryAddress: true, deliveryTime: true, person: { select: { firstName: true, lastName: true, phone: true, mobile: true } }, job: { select: { id: true, jobCode: true, name: true, returnedAt: true, status: true } } } } } },
  checkoutRecords: { orderBy: { checkoutTime: 'desc' as const }, take: 1, select: { checkoutTime: true, returnTime: true, driverReturnedAt: true, selfCheckout: true, driver: { select: { firstName: true, lastName: true, phone: true } } } },
} as const

function shapeAssignment(a: {
  status: string; startDate: Date; endDate: Date
  asset: { unitName: string; category: { name: string } }
  checkoutRecords: Array<{ checkoutTime: Date; returnTime: Date | null; driverReturnedAt: Date | null; selfCheckout: boolean; driver: { firstName: string; lastName: string; phone: string | null } | null }>
}) {
  const co = a.checkoutRecords[0]
  return {
    unit: a.asset.unitName,
    category: a.asset.category.name,
    from: d(a.startDate), to: d(a.endDate),
    status: a.status,
    driver: co?.driver ? { name: person(co.driver), phone: co.driver.phone } : null,
    checkedOutAt: co ? co.checkoutTime.toISOString() : null,
    returnedAt: co?.returnTime?.toISOString() ?? co?.driverReturnedAt?.toISOString() ?? null,
  }
}

export async function staffLookupUnit(id: SenderIdentity, unitQuery: string) {
  if (!id.staff) return { error: 'not authorized' }
  const q = unitQuery.trim()
  if (!q) return { error: 'which unit?' }
  const digits = q.replace(/\D/g, '')
  const assets = await prisma.asset.findMany({
    where: { isActive: true, ...(digits ? { unitName: { contains: digits } } : { unitName: { contains: q, mode: 'insensitive' } }) },
    select: { id: true, unitName: true, status: true, category: { select: { name: true } } },
  })
  const matched = digits ? assets.filter((a) => a.unitName.match(/(\d+)\s*$/)?.[1] === digits) : assets
  if (matched.length === 0) return { found: false, hint: `No active unit matches "${q}".` }
  if (matched.length > 1) return { found: false, ambiguous: matched.map((a) => `${a.unitName} (${a.category.name})`) }
  const asset = matched[0]
  const { from, to } = currentWindow()
  const rows = await prisma.bookingAssignment.findMany({
    where: { assetId: asset.id, status: { in: ['ASSIGNED', 'CHECKED_OUT'] }, startDate: { lte: to }, endDate: { gte: from }, bookingItem: { booking: { status: { notIn: ['CANCELLED', 'ARCHIVED'] }, archivedAt: null } } },
    select: ASSIGNMENT_SELECT,
    orderBy: { startDate: 'asc' },
    take: 5,
  })
  return {
    found: true,
    unit: asset.unitName, category: asset.category.name, assetStatus: asset.status,
    assignments: rows.map((a) => {
      const b = a.bookingItem.booking
      return {
        ...shapeAssignment(a),
        job: b.job ? { code: b.job.jobCode, name: b.job.name, status: b.job.status, returnedAt: d(b.job.returnedAt) } : { name: b.jobName },
        requester: { name: person(b.person), phone: b.person.mobile ?? b.person.phone ?? null },
        delivery: b.deliveryAddress ? { address: b.deliveryAddress, time: b.deliveryTime } : null,
      }
    }),
  }
}

export async function staffLookupJob(id: SenderIdentity, query: string) {
  if (!id.staff) return { error: 'not authorized' }
  const q = query.trim()
  if (!q) return { error: 'which job?' }
  const jobs = await prisma.job.findMany({
    where: { archivedAt: null, OR: [{ jobCode: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }, { company: { name: { contains: q, mode: 'insensitive' } } }] },
    orderBy: { updatedAt: 'desc' },
    take: 4,
    select: {
      id: true, jobCode: true, name: true, status: true, returnedAt: true,
      company: { select: { name: true } }, agent: { select: { name: true } },
      jobContacts: { select: { role: true, isPrimary: true, person: { select: { firstName: true, lastName: true, phone: true, mobile: true } } } },
      orders: { where: { status: { notIn: ['CANCELLED'] } }, orderBy: { startDate: 'asc' }, take: 6, select: { orderNumber: true, status: true, startDate: true, endDate: true } },
      bookings: { where: { archivedAt: null, status: { notIn: ['CANCELLED', 'ARCHIVED'] } }, orderBy: { startDate: 'asc' }, take: 6, select: { status: true, startDate: true, endDate: true, deliveryAddress: true, deliveryTime: true, items: { select: { assignments: { where: { status: { notIn: ['SWAPPED'] } }, select: ASSIGNMENT_SELECT } } } } },
    },
  })
  if (jobs.length === 0) return { found: false, hint: `No job matches "${q}".` }
  if (jobs.length > 1 && !jobs.some((j) => j.jobCode.toLowerCase() === q.toLowerCase())) {
    return { found: false, ambiguous: jobs.map((j) => `${j.name} (${j.jobCode}, ${j.company.name})`) }
  }
  const j = jobs.find((x) => x.jobCode.toLowerCase() === q.toLowerCase()) ?? jobs[0]
  const units = j.bookings.flatMap((b) => b.items.flatMap((it) => it.assignments.map(shapeAssignment)))
  const allBack = units.length > 0 && units.every((u) => u.status === 'RETURNED')
  return {
    found: true,
    job: { code: j.jobCode, name: j.name, company: j.company.name, agent: j.agent.name, status: j.status, markedReturnedAt: d(j.returnedAt) },
    returned: j.returnedAt ? 'marked returned' : allBack ? 'every unit checked back in' : units.some((u) => u.status === 'CHECKED_OUT') ? 'still out' : 'not yet out',
    orders: j.orders.map((o) => ({ number: o.orderNumber, status: o.status, from: d(o.startDate), to: d(o.endDate) })),
    bookings: j.bookings.map((b) => ({ status: b.status, from: d(b.startDate), to: d(b.endDate), delivery: b.deliveryAddress ? { address: b.deliveryAddress, time: b.deliveryTime } : null })),
    units,
    contacts: j.jobContacts.map((c) => ({ role: c.role, primary: c.isPrimary, name: person(c.person), phone: c.person.mobile ?? c.person.phone ?? null })),
  }
}

/** A production contact's own current jobs — the bookings, units, dates, and their agent. */
export async function contactJobInfo(id: SenderIdentity) {
  if (id.contactJobs.length === 0) return { error: 'not authorized' }
  const jobs = await prisma.job.findMany({
    where: { id: { in: id.contactJobs.map((j) => j.jobId) }, ...currentJobWhere() },
    select: {
      jobCode: true, name: true, status: true, returnedAt: true,
      agent: { select: { name: true, email: true } },
      orders: { where: { status: { notIn: ['CANCELLED'] } }, orderBy: { startDate: 'asc' }, take: 6, select: { orderNumber: true, status: true, startDate: true, endDate: true } },
      bookings: { where: { archivedAt: null, status: { notIn: ['CANCELLED', 'ARCHIVED'] } }, orderBy: { startDate: 'asc' }, take: 6, select: { status: true, startDate: true, endDate: true, deliveryAddress: true, deliveryTime: true, items: { select: { category: { select: { name: true } }, assignments: { where: { status: { notIn: ['SWAPPED'] } }, select: ASSIGNMENT_SELECT } } } } },
    },
  })
  return {
    jobs: jobs.map((j) => ({
      code: j.jobCode, name: j.name, status: j.status,
      agent: { name: j.agent.name, email: j.agent.email },
      orders: j.orders.map((o) => ({ number: o.orderNumber, status: o.status, from: d(o.startDate), to: d(o.endDate) })),
      bookings: j.bookings.map((b) => ({
        status: b.status, from: d(b.startDate), to: d(b.endDate),
        delivery: b.deliveryAddress ? { address: b.deliveryAddress, time: b.deliveryTime } : null,
        items: b.items.map((it) => ({ category: it.category.name, units: it.assignments.map(shapeAssignment) })),
      })),
    })),
  }
}
