/**
 * AHA partner level — a partner's contact asks about THEIR bookings, nothing more.
 *
 *   npm run test:aha-partner
 *
 * Wes 2026-09-15 (Clifford Fields, California Rent A Car): "When is the
 * Suburban coming back?" Pinned, with Prisma stubbed:
 *   - a number on a partner's record is a partner; a service vendor's is not
 *     (the query filters those — asserted on the where clause)
 *   - partnerBookings refuses anyone below/beside partner level
 *   - it asks only for that vendor's rows and never selects the production's
 *     name, company, addresses, rates or codes
 *   - the status words tell the partner what is waiting on them
 */
import Module from 'module'

let vendorWhere: unknown = null
let subWhere: unknown = null
let subSelect: Record<string, unknown> = {}
const vendorRows = [{ id: 'v1', name: 'California Rent A Car', phone: '(310) 477-2727', contactName: 'Clifford Fields', contacts: [{ name: 'Clifford Fields', phone: '310-555-0177', role: 'OWNER' }] }]
const subRows = [
  { itemDescription: 'Chevy Suburban', quantity: 1, startDate: new Date('2026-09-14T00:00:00Z'), endDate: new Date('2026-09-17T00:00:00Z'), status: 'ON_RENT', vendorConfirmedAt: new Date(), vendorDeclinedAt: null, driverName: null, vendorId: 'v1', subcontractedVehicle: { name: 'Suburban LT' }, job: { jobCode: 'SR-JOB-0300', returnedAt: null } },
  { itemDescription: 'Reefer van', quantity: 1, startDate: new Date('2026-09-20T00:00:00Z'), endDate: new Date('2026-09-21T00:00:00Z'), status: 'REQUESTED', vendorConfirmedAt: null, vendorDeclinedAt: null, driverName: null, vendorId: 'v1', subcontractedVehicle: null, job: null },
]

const origLoad = (Module as never as { _load: (...a: unknown[]) => unknown })._load
;(Module as never as { _load: unknown })._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req.endsWith('/lib/prisma') || req === '@/lib/prisma') {
    return {
      prisma: {
        vendor: { findMany: async (a: { where: unknown }) => { vendorWhere = a.where; return vendorRows } },
        subRental: { findMany: async (a: { where: unknown; select: Record<string, unknown> }) => { subWhere = a.where; subSelect = a.select; return subRows } },
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
  const { partnersForNumber, partnerPhones } = await import('../../src/lib/assistant/partnerIdentity')
  const { partnerBookings, partnerStatusWords } = await import('../../src/lib/assistant/lookups')
  const { NO_IDENTITY } = await import('../../src/lib/assistant/senderIdentity')

  console.log('identity')
  const hits = await partnersForNumber('+13105550177')
  check('Clifford’s cell matches California Rent A Car', hits.length === 1 && hits[0].vendorName === 'California Rent A Car' && hits[0].personName === 'Clifford Fields', hits)
  check('the office line on the vendor matches too', (await partnersForNumber('3104772727')).length === 1)
  check('a stranger matches nothing', (await partnersForNumber('+12135550000')).length === 0)
  check('only partners are loaded: marked, or with bookings or roster units', JSON.stringify(vendorWhere).includes('partnerMarkedAt') && JSON.stringify(vendorWhere).includes('subRentals') && JSON.stringify(vendorWhere).includes('subcontractedVehicles'), vendorWhere)
  check('short numbers are ignored', partnerPhones([{ id: 'x', name: 'X', phone: '555-0100', contactName: null, contacts: [] }]).length === 0)

  console.log('lookup scope')
  check('public is refused', JSON.stringify(await partnerBookings(NO_IDENTITY)) === JSON.stringify({ error: 'not authorized' }))
  check('a contact is refused', JSON.stringify(await partnerBookings({ ...NO_IDENTITY, level: 'contact', contactJobs: [{ jobId: 'j', jobCode: 'J', name: 'N', role: 'PM' }] })) === JSON.stringify({ error: 'not authorized' }))
  const partner = { ...NO_IDENTITY, level: 'partner' as const, partner: { vendors: [{ id: 'v1', name: 'California Rent A Car' }], personName: 'Clifford Fields' } }
  const res = await partnerBookings(partner, new Date('2026-09-15T18:00:00Z')) as { bookings: Array<Record<string, unknown>> }
  check('asks only for that vendor', JSON.stringify(subWhere).includes('"vendorId":{"in":["v1"]}'), subWhere)
  check('cancelled rows are excluded', JSON.stringify(subWhere).includes('"status":{"not":"CANCELLED"}'))
  const selected = JSON.stringify(subSelect)
  check('never selects production name, company, address, rates or codes', !/jobName|company|name":true,"jobCode|address|Address|Rate|Total|clientTotal|onSite|callTime|driverPhone|gate|lockbox/.test(selected.replace('"subcontractedVehicle":{"select":{"name":true}}', '')), selected)
  check('the Suburban comes back with its unit name and return date', res.bookings[0].unit === 'Suburban LT' && res.bookings[0].to === '2026-09-17' && res.bookings[0].status === 'out on rent', res.bookings[0])
  check('no production name in the payload', !JSON.stringify(res).match(/Lunch|production company|client/i))

  console.log('status words')
  check('an unconfirmed hold is waiting on them', /waiting on you/.test(partnerStatusWords({ status: 'REQUESTED', vendorConfirmedAt: null, vendorDeclinedAt: null })))
  check('a pitch holds nothing', /nothing held/.test(partnerStatusWords({ status: 'ESTIMATED', vendorConfirmedAt: null, vendorDeclinedAt: null })))
  check('a declined hold says so', /could not hold/.test(partnerStatusWords({ status: 'REQUESTED', vendorConfirmedAt: null, vendorDeclinedAt: new Date() })))

  if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
  console.log('\nall passing')
}
void main()
