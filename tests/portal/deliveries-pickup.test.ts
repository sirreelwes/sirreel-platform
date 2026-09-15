/**
 * Client portal — a partner car picked up at the partner's lot.
 *
 *   npm run test:portal-pickup
 *
 * Wes 2026-09-15: "fix the client portal pickup location." A WILL_CALL
 * sub-rental used to render as "coming to you" with a drop-off form and no
 * address to go to. Pinned, with Prisma stubbed:
 *   - it comes back as handoff PICKUP with the booking's origin override, else
 *     the partner's lot
 *   - no driver, no call time, not editable
 *   - the partner's NAME still needs permission; the lot address never appears
 *     on a delivered row
 *   - delivered partner units are unchanged
 */
import Module from 'module'

const D = (s: string) => new Date(`${s}T00:00:00Z`)
const sub = (over: Record<string, unknown>) => ({
  id: 's1', itemDescription: 'Chevy Suburban', status: 'CONFIRMED', startDate: D('2026-09-20'), endDate: D('2026-09-22'),
  driverName: 'Should Not Show', driverAssignedAt: null, callTime: '6am', driverNotes: 'gate', logisticsUpdatedAt: null,
  driverAckedAt: null, driverAckNote: null, driverHours: [], receiveMethod: 'WILL_CALL', originAddress: null,
  vendor: { name: 'California Rent A Car', nameClientFacing: false, lotAddress: '5890 Adams Blvd, Culver City, CA 90232' },
  subcontractedVehicle: { vehicleType: 'SUV' },
  ...over,
})
let rows: unknown[] = []

const origLoad = (Module as never as { _load: (...a: unknown[]) => unknown })._load
;(Module as never as { _load: unknown })._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req.endsWith('/lib/prisma') || req === '@/lib/prisma') {
    return {
      prisma: {
        job: { findUnique: async () => ({ reportToAddress: null, reportToAccessNotes: null, reportToTime: null, reportToContactName: null, reportToContactPhone: null, reportToUpdatedAt: null, pickupSameAsDelivery: true, pickupAddress: null, pickupAccessNotes: null, pickupTime: null }) },
        subRental: { findMany: async () => rows },
        order: { findMany: async () => [] },
      },
    }
  }
  return (origLoad as (...a: unknown[]) => unknown).apply(this, [req, parent, isMain])
}

let failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
}

async function main() {
  const { loadDeliveries } = await import('../../src/lib/portal/deliveries')

  rows = [sub({})]
  let u = (await loadDeliveries('j1')).units[0]
  check('a will-call car is a PICKUP', u.handoff === 'PICKUP', u)
  check('pickup address is the partner lot', u.pickupAt?.address === '5890 Adams Blvd, Culver City, CA 90232')
  check('no driver, no call time, no note, not editable', u.driver === null && u.callTime === null && u.driverNotes === null && u.editable === false)
  check('partner not named without permission', u.suppliedBy === null)

  rows = [sub({ originAddress: 'Lot B, 100 Main St' })]
  u = (await loadDeliveries('j1')).units[0]
  check('the booking’s origin override wins over the lot', u.pickupAt?.address === 'Lot B, 100 Main St')

  rows = [sub({ vendor: { name: 'California Rent A Car', nameClientFacing: true, lotAddress: '5890 Adams Blvd' } })]
  u = (await loadDeliveries('j1')).units[0]
  check('named when the partner permitted it', u.suppliedBy === 'California Rent A Car')

  rows = [sub({ receiveMethod: 'PICKUP', driverName: 'Marco' })]
  const driven = (await loadDeliveries('j1')).units[0]
  check('a driven partner unit is still DELIVERED with its driver', driven.handoff === 'DELIVERED' && driven.driver?.name === 'Marco' && driven.editable)
  check('the partner lot address never rides on a delivered row', driven.pickupAt === null && !JSON.stringify(driven).includes('Adams'))

  rows = [sub({ receiveMethod: null })]
  check('legacy null stays DELIVERED', (await loadDeliveries('j1')).units[0].handoff === 'DELIVERED')

  rows = [sub({ status: 'CANCELLED' })]
  check('a cancelled pickup is not listed', (await loadDeliveries('j1')).units.length === 0)

  if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
  console.log('\nall passing')
}
void main()
