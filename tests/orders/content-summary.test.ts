/**
 * Order content-summary tests.
 *
 *   npx tsx tests/orders/content-summary.test.ts
 *   npm run test:order-summary
 *
 * Pure + offline. Guards the two failure directions that make the line
 * worse than no line: a summary that hides the rental behind a fee or a
 * kit piece, and a summary that says "Vehicles" when it could say which
 * vehicle.
 */
import { orderContentSummary, type SummarizableLine } from '../../src/lib/orders/contentSummary'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}\n      got  ${g}\n      want ${w}`); failures.push(why) }
}

const line = (o: Partial<SummarizableLine>): SummarizableLine => ({
  description: 'Item', department: 'PRO_SUPPLIES', type: 'EQUIPMENT', quantity: 1, parentLineItemId: null, ...o,
})

console.log('\nnaming vs collapsing')
eq(orderContentSummary([
  line({ description: 'SuperCube Truck', department: 'VEHICLES', type: 'VEHICLE' }),
  line({ description: 'Furniture Pads', quantity: 10 }),
  line({ description: 'Straps, Ratchet', quantity: 10 }),
]), 'SuperCube Truck · Pro Supplies', 'vehicles named, commodity department collapsed')

eq(orderContentSummary([
  line({ description: 'SuperCube Truck', department: 'VEHICLES', type: 'VEHICLE' }),
  line({ description: 'SuperCube Truck', department: 'VEHICLES', type: 'VEHICLE' }),
]), 'SuperCube Truck ×2', 'two of the same unit sum into one ×N token')

eq(orderContentSummary([
  line({ description: 'Motorola CP200 UHF Radio', department: 'COMMUNICATIONS', quantity: 30 }),
  line({ description: 'Chairs, Folding', quantity: 40 }),
]), 'Communications · Pro Supplies', 'departments render in canonical order, never by quantity')

console.log('\nwhat never speaks for the order')
eq(orderContentSummary([
  line({ description: 'Limited Collision Damage Waiver — 1 vehicle', department: 'VEHICLES', type: 'FEE' }),
  line({ description: 'Cargo Van w/ Liftgate', department: 'VEHICLES', type: 'VEHICLE' }),
]), 'Cargo Van w/ Liftgate', 'a standalone fee never stands in for the scope')

eq(orderContentSummary([
  line({ description: 'Limited Collision Damage Waiver — 1 vehicle', department: 'VEHICLES', type: 'FEE' }),
]), 'Fees', 'a fees-only order still says so')

eq(orderContentSummary([
  line({ id: 'p', description: 'Star Coach', department: 'VEHICLES', type: 'VEHICLE' } as SummarizableLine),
  line({ description: 'Mileage', department: 'VEHICLES', parentLineItemId: 'p' }),
]), 'Star Coach', 'kit pieces ride under their parent, not in the summary')

eq(orderContentSummary([]), null, 'an empty order has no summary line')

console.log('\noverflow + unknown departments')
eq(orderContentSummary([
  line({ description: 'A', department: 'VEHICLES' }),
  line({ description: 'B', department: 'VEHICLES' }),
  line({ description: 'C', department: 'VEHICLES' }),
  line({ description: 'D', department: 'VEHICLES' }),
  line({ description: 'E', department: 'VEHICLES' }),
]), 'A · B · C · +2 more', 'named units cap at three, the rest are counted')

eq(orderContentSummary([
  line({ description: 'Lankershim Studios', department: 'STAGES' }),
  line({ description: 'Whatever', department: 'FUTURE_DEPT' }),
]), 'Lankershim Studios · FUTURE_DEPT', 'a stage is named; an unknown department still shows up')

console.log(failures.length === 0 ? '\nAll passed.\n' : `\n${failures.length} FAILED\n`)
process.exit(failures.length === 0 ? 0 : 1)
