/**
 * The kit double-check — "did the antennas go out with the radios?"
 *
 *   npx tsx tests/orders/kit-completeness.test.ts
 *   npm run test:kit-completeness
 *
 * Pure decisions, no DB. This guards the check that stands between a
 * walkie order and a crew on location with no antennas (Wes,
 * 2026-09-13, after it happened twice in a week), so the cases that
 * matter are the ones where it must STAY QUIET as much as the ones
 * where it must shout: a check-out sheet that cries short on a
 * correctly loaded truck is a check-out sheet the floor learns to click
 * through.
 */

import {
  kitShortfalls,
  describeShortfall,
  type KitExpectation,
} from '../../src/lib/orders/kitCompleteness'
import { buildKitExpectations, type KitRule } from '../../src/lib/orders/kitExpectations'

const failures: string[] = []

function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message)
  else console.log(`  ok — ${message}`)
}

// ── The live walkie catalog, as configured 2026-08-29 / 2026-09-11 ──
const RADIO_D = 'item-radio-digital'
const RADIO_A = 'item-radio-analog'
const ANTENNA = 'item-antenna'
const BATTERY_1_1 = 'item-battery-in-radio'
const SPARE = 'item-spare-battery'
const BANK = 'item-charger-bank'

function rule(over: Partial<KitRule> & Pick<KitRule, 'parentItemId' | 'pieceItemId'>): KitRule {
  return {
    parentName: 'Motorola CP200 UHF Radio (Digital)',
    pieceName: 'CP200 - Antenna',
    qtyPer: 1,
    perUnits: 1,
    rounding: 'CEIL',
    minQty: 0,
    sortOrder: 0,
    ...over,
  }
}

const RULES: KitRule[] = [
  rule({ parentItemId: RADIO_D, pieceItemId: ANTENNA, pieceName: 'CP200 - Antenna' }),
  rule({ parentItemId: RADIO_A, pieceItemId: ANTENNA, pieceName: 'CP200 - Antenna', parentName: 'Motorola CP200 UHF Radio (Analog)' }),
  rule({ parentItemId: RADIO_D, pieceItemId: BATTERY_1_1, pieceName: 'CP200 - Battery' }),
  rule({ parentItemId: RADIO_D, pieceItemId: SPARE, pieceName: 'Motorola CP200 Battery', qtyPer: 0.5 }),
  rule({ parentItemId: RADIO_D, pieceItemId: BANK, pieceName: 'Motorola CP200 6-Bank Charger', qtyPer: 1, perUnits: 12, rounding: 'FLOOR', minQty: 1 }),
  rule({ parentItemId: RADIO_A, pieceItemId: BANK, pieceName: 'Motorola CP200 6-Bank Charger', parentName: 'Motorola CP200 UHF Radio (Analog)', qtyPer: 1, perUnits: 12, rounding: 'FLOOR', minQty: 1 }),
]

type Line = { id: string; inventoryItemId: string | null }

console.log('\nkit completeness\n')

// ── The defect itself ───────────────────────────────────────────────
{
  const lines: Line[] = [
    { id: 'l-radio', inventoryItemId: RADIO_D },
    { id: 'l-antenna', inventoryItemId: ANTENNA },
    { id: 'l-batt', inventoryItemId: BATTERY_1_1 },
    { id: 'l-spare', inventoryItemId: SPARE },
    { id: 'l-bank', inventoryItemId: BANK },
  ]
  const exp = buildKitExpectations(lines, RULES)

  // Everything loaded — the common day, and it must be silent.
  const complete = kitShortfalls(exp, {
    'l-radio': 12, 'l-antenna': 12, 'l-batt': 12, 'l-spare': 6, 'l-bank': 1,
  })
  check(complete.length === 0, 'a fully loaded walkie order raises nothing')

  // The actual failure: radios counted out, antennas at zero.
  const short = kitShortfalls(exp, {
    'l-radio': 12, 'l-antenna': 0, 'l-batt': 12, 'l-spare': 6, 'l-bank': 1,
  })
  check(short.length === 1 && short[0].pieceItemId === ANTENNA, '12 radios with 0 antennas is caught')
  check(short[0].expected === 12 && short[0].counted === 0, 'it says 0 of 12')
  check(!short[0].missingFromOrder, 'the antenna line was on the order, so it is the floor’s to fix')

  // Under-counted, not absent — half the antennas went.
  const half = kitShortfalls(exp, {
    'l-radio': 12, 'l-antenna': 6, 'l-batt': 12, 'l-spare': 6, 'l-bank': 1,
  })
  check(half.length === 1 && half[0].counted === 6, 'a partial antenna count is short too')

  // More than owed is not a shortfall — the client asked for extras.
  const over = kitShortfalls(exp, {
    'l-radio': 12, 'l-antenna': 20, 'l-batt': 12, 'l-spare': 6, 'l-bank': 1,
  })
  check(over.length === 0, 'counting out MORE than the kit owes is not short')
}

// ── The piece that is not on the order at all ───────────────────────
{
  // A pre-seed order: radios, no antenna line anywhere. This is the one
  // the floor cannot fix from the sheet, because it never printed.
  const lines: Line[] = [
    { id: 'l-radio', inventoryItemId: RADIO_D },
    { id: 'l-spare', inventoryItemId: SPARE },
    { id: 'l-bank', inventoryItemId: BANK },
  ]
  const exp = buildKitExpectations(lines, RULES)
  const short = kitShortfalls(exp, { 'l-radio': 12, 'l-spare': 6, 'l-bank': 1 })
  const antenna = short.find((s) => s.pieceItemId === ANTENNA)
  check(!!antenna, 'an order with no antenna line at all is caught')
  check(antenna?.missingFromOrder === true, 'and is marked as the desk’s fix, not the floor’s')
  check(
    describeShortfall(antenna!).includes('not on the order'),
    'the wording says so out loud',
  )
}

// ── Grouping: shared parents must not double-count ──────────────────
{
  // 6 analog + 6 digital radios need ONE bank between them, not one
  // each. Grouping per parent would demand two and cry short on a
  // perfectly loaded truck — the exact way a warning gets ignored.
  const lines: Line[] = [
    { id: 'l-analog', inventoryItemId: RADIO_A },
    { id: 'l-digital', inventoryItemId: RADIO_D },
    { id: 'l-antenna', inventoryItemId: ANTENNA },
    { id: 'l-bank', inventoryItemId: BANK },
  ]
  const exp = buildKitExpectations(lines, RULES)
  const bank = exp.find((e) => e.pieceItemId === BANK)
  check(bank?.parentLineIds.length === 2, 'both radio lines size the one charging bank')

  const short = kitShortfalls(exp, {
    'l-analog': 6, 'l-digital': 6, 'l-antenna': 12, 'l-bank': 1,
  })
  check(
    !short.some((s) => s.pieceItemId === BANK),
    '12 radios across two lines are happy with a single bank',
  )
}

// ── Nothing of the parent is going out ──────────────────────────────
{
  const lines: Line[] = [
    { id: 'l-radio', inventoryItemId: RADIO_D },
    { id: 'l-bank', inventoryItemId: BANK },
  ]
  const exp = buildKitExpectations(lines, RULES)

  // The radios stayed on the shelf (a partial pull, or they were
  // zeroed). minQty 1 on the charging bank must NOT then demand a bank
  // for gear nobody is taking.
  const none = kitShortfalls(exp, { 'l-radio': 0, 'l-bank': 0 })
  check(none.length === 0, 'a parent counted at zero owes nothing, minQty included')

  // Radios left off this sheet entirely — silence about them, not a zero.
  const off = kitShortfalls(exp, { 'l-radio': null, 'l-bank': null })
  check(off.length === 0, 'a parent left off a partial sheet owes nothing')

  // But radios ON the sheet with the bank left OFF it is short — the
  // point of the check is that the truck leaves incomplete either way.
  const parentOnly = kitShortfalls(exp, { 'l-radio': 12, 'l-bank': null })
  check(
    parentOnly.some((s) => s.pieceItemId === BANK),
    'radios going out while the bank stays behind is short',
  )
}

// ── Ratios ──────────────────────────────────────────────────────────
{
  const lines: Line[] = [
    { id: 'l-radio', inventoryItemId: RADIO_D },
    { id: 'l-spare', inventoryItemId: SPARE },
    { id: 'l-antenna', inventoryItemId: ANTENNA },
    { id: 'l-batt', inventoryItemId: BATTERY_1_1 },
    { id: 'l-bank', inventoryItemId: BANK },
  ]
  const exp = buildKitExpectations(lines, RULES)
  // 15 radios → 8 spares (0.5 CEIL), not 7. Wes's ratio, 2026-08-17.
  const short = kitShortfalls(exp, {
    'l-radio': 15, 'l-spare': 7, 'l-antenna': 15, 'l-batt': 15, 'l-bank': 1,
  })
  const spare = short.find((s) => s.pieceItemId === SPARE)
  check(spare?.expected === 8, '15 radios want 8 spare batteries, and 7 is short')
}

// ── An order with nothing kitted ────────────────────────────────────
{
  const exp = buildKitExpectations(
    [{ id: 'l-tape', inventoryItemId: 'item-gaff-tape' }, { id: 'l-typed', inventoryItemId: null }],
    RULES,
  )
  check(exp.length === 0, 'an order with no kitted item builds no expectations')
  check(kitShortfalls(exp, { 'l-tape': 4 }).length === 0, 'and raises nothing')
}

// ── The empty catalog ───────────────────────────────────────────────
{
  const exp: KitExpectation[] = buildKitExpectations(
    [{ id: 'l-radio', inventoryItemId: RADIO_D }],
    [],
  )
  check(exp.length === 0, 'no kit rules configured → no expectations, no noise')
}

console.log()
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('all kit-completeness checks passed\n')
