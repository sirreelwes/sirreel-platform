/**
 * The discount waterfall on a partner's unit.
 *
 *   npm run test:discount-waterfall
 *
 * Pure + offline. Wes 2026-09-11, on VSM Planet (deal 35%, will go to
 * 40–43% to keep a client, SirReel's floor 10%): share the discount until
 * the partner hits their maximum, then take it from SirReel's share down to
 * the floor, and decline anything deeper — "if the client asks for 35% off,
 * we should decline."
 *
 * The dangerous direction is silent: a partner paid on list while the client
 * paid 35% less shows up nowhere until the month's margin is gone.
 */
import {
  applyMarginChange,
  describeDeal,
  discountWaterfall,
  evaluatePartnerLines,
  floorBreaches,
  floorMessage,
  type MarginInputs,
  type PartnerLineInput,
  type PartnerLineMargin,
} from '../../src/lib/sub-rentals/discountWaterfall'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  if (got === want) console.log(`  ok — ${why}`)
  else failures.push(`${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

// ── VSM Planet on $1,000: deal 35, maximum 43 ────────────────────────────────
console.log('VSM Planet, $1,000 list, deal 35%, maximum 43%')
const vsm = (off: number, max: number | null = 43) =>
  discountWaterfall({ list: 1000, billed: 1000 * (1 - off / 100), sharePercent: 35, maxSharePercent: max })

let w = vsm(0)
eq(w.partnerPay, 650, 'no discount: VSM gets $650')
eq(w.sirreelKeep, 350, 'no discount: SirReel keeps $350')
eq(w.stage, 'none', 'no discount: stage none')
eq(w.maxDiscountPercent, 33, 'deepest discount allowed is 33%')
eq(w.minBilled, 670, 'lowest client price is $670')

w = vsm(10)
eq(w.partnerPay, 600, '10% off: shared — VSM $600')
eq(w.sirreelKeep, 300, '10% off: shared — SirReel $300')
eq(w.stage, 'shared', '10% off: still sharing')
eq(w.effectiveSharePercent, 40, '10% off: VSM paid on 40%')

w = vsm(16)
eq(w.partnerPay, 570, '16% off: VSM reaches its 43% — $570')
eq(w.sirreelKeep, 270, '16% off: SirReel $270')
eq(w.stage, 'sirreel', '16% off: VSM is at its maximum')
eq(w.concessionPercent, 8, '16% off: VSM gave 8 points')

w = vsm(30)
eq(w.partnerPay, 570, '30% off: VSM stays at $570')
eq(w.sirreelKeep, 130, '30% off: SirReel alone gives — $130')
eq(w.allowed, true, '30% off: allowed')

w = vsm(33)
eq(w.sirreelKeep, 100, '33% off: SirReel at its $100 floor')
eq(w.allowed, true, '33% off: allowed, exactly at the floor')

w = vsm(35)
eq(w.allowed, false, '35% off: DECLINED (Wes)')
eq(w.stage, 'declined', '35% off: stage declined')
eq(w.sirreelKeep, 80, '35% off: SirReel would keep $80')
eq(w.partnerPay, 570, '35% off: VSM still never below its maximum')

console.log('VSM at the low end of its range, 40%')
w = vsm(10, 40)
eq(w.partnerPay, 600, '40% max, 10% off: VSM reaches $600')
eq(w.stage, 'sirreel', '40% max, 10% off: VSM at maximum')
eq(vsm(30, 40).sirreelKeep, 100, '40% max, 30% off: floor')
eq(vsm(31, 40).allowed, false, '40% max, 31% off: declined')
eq(vsm(35, 40).allowed, false, '40% max, 35% off: declined')

console.log('A partner that does not flex')
w = vsm(25, null)
eq(w.partnerPay, 650, 'no maximum: partner paid on their deal')
eq(w.sirreelKeep, 100, 'no maximum, 25% off: SirReel alone, at the floor')
eq(vsm(26, null).allowed, false, 'no maximum, 26% off: declined')

console.log('A deal thinner than the floor (8%, maximum 20%)')
const thin = (off: number) => discountWaterfall({ list: 1000, billed: 1000 - off * 10, sharePercent: 8, maxSharePercent: 20 })
eq(thin(0).allowed, true, 'no discount is never refused, whatever the deal')
eq(thin(0).sirreelKeep, 80, 'no discount: SirReel keeps its $80 deal')
eq(thin(10).partnerPay, 820, '10% off: the partner covers it alone, inside their maximum')
eq(thin(10).sirreelKeep, 80, '10% off: SirReel does not go lower')
eq(thin(10).allowed, true, '10% off: allowed')
eq(thin(15).allowed, false, '15% off: past the partner maximum — declined')

console.log('A price above list')
w = discountWaterfall({ list: 1000, billed: 1100, sharePercent: 35, maxSharePercent: 43 })
eq(w.discount, 0, 'no discount above list')
eq(w.partnerPay, 650, 'partner still paid on list')
eq(w.sirreelKeep, 450, 'the markup is SirReel’s')

// ── On an order: department + order discounts spread over the lines ────────
console.log('On an order')
const partnerLine = (over: Partial<PartnerLineInput> = {}): PartnerLineInput => ({
  lineId: 'L1', subRentalId: 'S1', department: 'VEHICLES', quantity: 1, billableDays: 1, rate: 1000, lineTotal: 1000,
  vendorName: 'VSM Planet', unitName: 'Star Wagon', listDaily: 1000, sharePercent: 35, maxSharePercent: 43, committedDaily: null,
  ...over,
})
const orderOf = (p: PartnerLineInput, discounts: MarginInputs['discounts']): MarginInputs => ({
  taxRate: 0.095,
  lines: [
    { id: p.lineId, department: p.department, type: 'VEHICLE', lineTotal: p.lineTotal },
    { id: 'OWN', department: 'PRO_SUPPLIES', type: 'EQUIPMENT', lineTotal: 1000 },
    { id: 'EXP', department: 'EXPENDABLES', type: 'EQUIPMENT', lineTotal: 100 },
  ],
  discounts,
  partnerLines: [p],
})

let m = evaluatePartnerLines(orderOf(partnerLine(), [
  { scope: 'DEPARTMENT', departmentKey: 'VEHICLES', type: 'PERCENT', value: 10, label: 'Vehicles' },
  { scope: 'ORDER', departmentKey: null, type: 'PERCENT', value: 20, label: 'Order' },
]))[0]
eq(m.waterfall?.billed, 720, 'vehicles 10% then order 20%: the unit bills $720')
eq(m.partnerPay, 570, '…VSM $570')
eq(m.sirreelKeep, 150, '…SirReel $150')
eq(m.status, 'ok', '…allowed')

m = evaluatePartnerLines(orderOf(partnerLine(), [{ scope: 'ORDER', departmentKey: null, type: 'FIXED', value: 500, label: 'Order' }]))[0]
eq(m.waterfall?.billed, 750, 'a $500 order discount spreads over the $2,000 discountable (expendables out): $750')

m = evaluatePartnerLines(orderOf(partnerLine(), [{ scope: 'ORDER', departmentKey: null, type: 'PERCENT', value: 35, label: 'Order' }]))[0]
eq(m.status, 'declined', 'a 35% order discount is declined on the partner unit')

m = evaluatePartnerLines(orderOf(partnerLine({ billableDays: 3, rate: 700, lineTotal: 2100 }), []))[0]
eq(m.partnerPay, 1710, '3 days at $700 against $1,000 list: VSM $1,710 ($570 × 3)')
eq(m.sirreelKeep, 390, '…SirReel $390')

m = evaluatePartnerLines(orderOf(partnerLine({ billableDays: null, rate: 700, lineTotal: 0 }), []))[0]
eq(m.status, 'ok', 'dates TBD: judged per day at the rate')
eq(m.partnerPay, 570, '…VSM $570 a day')

m = evaluatePartnerLines(orderOf(partnerLine({ rate: 700, lineTotal: 700, committedDaily: 650 }), []))[0]
eq(m.committed, true, 'a stamped rate is what the partner is owed')
eq(m.sirreelKeep, 50, '…so a later 30% leaves SirReel $50')
eq(m.status, 'declined', '…and that is below the floor')

eq(evaluatePartnerLines(orderOf(partnerLine({ sharePercent: null }), []))[0].status, 'no-deal', 'no deal set: not judged')
eq(evaluatePartnerLines(orderOf(partnerLine({ listDaily: null }), []))[0].status, 'no-list', 'no list rate: not judged — never the client price')

// ── The gate refuses only what an edit makes worse ──────────────────────────
console.log('The edit gate')
const base = orderOf(partnerLine(), [{ id: 'D1', scope: 'ORDER', departmentKey: null, type: 'PERCENT', value: 20, label: 'Order' }])
const raised = applyMarginChange(base, { discount: { id: 'D1', next: { id: 'D1', scope: 'ORDER', departmentKey: null, type: 'PERCENT', value: 35, label: 'Order' } } })
eq(raised.discounts.length, 1, 'replacing a discount keeps one ORDER row')
let breaches = floorBreaches(evaluatePartnerLines(base), evaluatePartnerLines(raised))
eq(breaches.length, 1, 'raising 20% → 35% is refused')
const msg = floorMessage(breaches)
eq(msg.includes('33% off ($670)'), true, 'the message names the deepest discount allowed')
eq(msg.includes('keep $80'), true, 'the message says what SirReel would keep')

const over = orderOf(partnerLine(), [{ id: 'D1', scope: 'ORDER', departmentKey: null, type: 'PERCENT', value: 40, label: 'Order' }])
const eased = applyMarginChange(over, { discount: { id: 'D1', next: { id: 'D1', scope: 'ORDER', departmentKey: null, type: 'PERCENT', value: 36, label: 'Order' } } })
eq(floorBreaches(evaluatePartnerLines(over), evaluatePartnerLines(eased)).length, 0, 'lowering a discount that is still over the line is allowed')
const removed = applyMarginChange(over, { discount: { id: 'D1', next: null } })
eq(removed.discounts.length, 0, 'removing drops the row')

const cut = applyMarginChange(base, { line: { id: 'L1', lineTotal: 800, rate: 800 } })
breaches = floorBreaches(evaluatePartnerLines(base), evaluatePartnerLines(cut))
eq(breaches.length, 1, 'cutting the partner line to $800 under a 20% order discount (36% off) is refused')

console.log('The Portals summary')
const told = describeDeal(35, 43)
eq(told.includes('they get $650 and SirReel keeps $350'), true, 'VSM summary: the no-discount split')
eq(told.includes('shared equally up to 16% off ($570 / $270)'), true, 'VSM summary: where sharing stops')
eq(told.includes('Deepest client discount: 33% off ($670)'), true, 'VSM summary: the deepest discount')
eq(describeDeal(35, null).includes('come out of SirReel’s share alone') || describeDeal(35, null).includes('comes out of SirReel’s share alone'), true, 'no maximum: SirReel alone')
eq(describeDeal(10, null).includes('No client discount fits'), true, 'a deal at the floor with no flex: nothing fits')

const noPartner: PartnerLineMargin[] = []
eq(floorBreaches(noPartner, noPartner).length, 0, 'an order with no partner units is never gated')

if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\nall discount-waterfall checks passed')
