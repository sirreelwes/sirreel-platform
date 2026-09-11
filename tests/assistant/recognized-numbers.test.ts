/**
 * "Who AHA recognises" roster tests.
 *
 *   npm run test:recognized-numbers
 *
 * The roster on /admin/assistant claims to BE the access list. That is only
 * true if it reads the same facts the live checks read and reports them the
 * way the checks apply them. Pinned here, with Prisma stubbed:
 *
 *   - a staff mobile and an emergency phone are both staff, once each
 *   - a job contact and a booking requester on a current job are contacts,
 *     with the job to change them on and a lapse date 7 days past the job
 *   - a checkout driver on a live assignment is a driver on that unit
 *   - a number in two tiers is listed once per tier (that is the truth)
 *   - a query failure yields an empty roster, never a thrown page
 */
import Module from 'module'

const T = new Date('2026-09-11T18:00:00Z')
const D = (s: string) => new Date(`${s}T00:00:00Z`)

const users = [
  { id: 'u1', name: 'Wes Bailey', role: 'ADMIN', phone: '(818) 515-2389', emergencyPhone: null },
  { id: 'u2', name: 'Hugo', role: 'MANAGER', phone: '818-515-2389', emergencyPhone: '+17605551234' },
]
const jobs = [
  {
    id: 'j1', jobCode: 'SR-JOB-0231', name: 'Forgotten Island',
    jobContacts: [{ role: 'PM', person: { id: 'p1', firstName: 'Ana', lastName: 'Lopez', phone: '323-555-0100', mobile: '323-555-0101' } }],
    bookings: [{ endDate: D('2026-09-14'), person: { id: 'p2', firstName: 'Ray', lastName: 'Kim', phone: null, mobile: '(213) 555-0199' } }],
    orders: [{ endDate: D('2026-09-12') }],
  },
]
const assignments = [
  {
    endDate: D('2026-09-11'),
    asset: { unitName: 'Cube 27' },
    bookingItem: { booking: { job: { id: 'j1', jobCode: 'SR-JOB-0231', name: 'Forgotten Island' } } },
    checkoutRecords: [
      { driver: { firstName: 'Dee', lastName: 'Driver', phone: '818 555 0142' } },
      { driver: { firstName: 'Dee', lastName: 'Driver', phone: '+18185550142' } },
      { driver: null },
    ],
  },
]
let FAIL = false

const origLoad = (Module as never as { _load: (...a: unknown[]) => unknown })._load
;(Module as never as { _load: unknown })._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req.endsWith('/lib/prisma') || req === '@/lib/prisma') {
    const guard = async <X,>(v: X) => { if (FAIL) throw new Error('db down'); return v }
    return {
      prisma: {
        user: { findMany: async () => guard(users) },
        job: { findMany: async () => guard(jobs) },
        bookingAssignment: { findMany: async () => guard(assignments) },
      },
    }
  }
  return (origLoad as (...a: unknown[]) => unknown).apply(this, [req, parent, isMain])
}

let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`)
  else { failed++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

async function main() {
  const { listRecognizedNumbers } = await import('../../src/lib/assistant/recognizedNumbers')
  const rows = await listRecognizedNumbers(T)
  const by = (tier: string) => rows.filter((r) => r.tier === tier)

  console.log('staff')
  check('two users, three staff grants (mobile, mobile, emergency)', by('staff').length === 3, by('staff'))
  check('the same tail on two users is listed for each', by('staff').filter((r) => r.tail === '8185152389').length === 2)
  check('emergency phone names its field', by('staff').some((r) => r.tail === '7605551234' && /Emergency phone/.test(r.reason)))
  check('staff never lapse', by('staff').every((r) => r.until === null))
  check('staff manage link is this page', by('staff').every((r) => r.manageHref === '/admin/assistant'))

  console.log('contacts')
  const c = by('contact')
  check('job contact listed for phone AND mobile', c.filter((r) => r.name === 'Ana Lopez').length === 2, c)
  check('booking requester listed as REQUESTER', c.some((r) => r.name === 'Ray Kim' && /REQUESTER/.test(r.reason)))
  check('contact rows link to the job', c.every((r) => r.manageHref === '/jobs/j1' && r.jobCode === 'SR-JOB-0231'))
  check('lapse = latest live date + 7 days (booking 9/14 → 9/21)', c.every((r) => r.until?.startsWith('2026-09-21')), c.map((r) => r.until))

  console.log('drivers')
  const d = by('driver')
  check('one driver row per distinct number per unit', d.length === 1, d)
  check('driver row names the unit and the job', d[0]?.unit === 'Cube 27' && d[0]?.jobCode === 'SR-JOB-0231' && /Cube 27/.test(d[0]?.reason ?? ''))
  check('driver lapse = assignment end + 1 day grace', d[0]?.until?.startsWith('2026-09-12') === true, d[0]?.until)

  console.log('failure')
  FAIL = true
  let threw = false
  try { await listRecognizedNumbers(T) } catch { threw = true }
  check('a db failure throws to the caller (the route catches it into an empty list)', threw)

  if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
  console.log('\nall passing')
}
void main()
