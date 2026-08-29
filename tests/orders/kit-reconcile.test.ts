/**
 * Included-accessory RECONCILE tests — what happens to the auto-added
 * lines when the order changes underneath them.
 *
 *   npx tsx tests/orders/kit-reconcile.test.ts
 *   npm run test:kit-reconcile
 *
 * Pure decisions, no DB. Companion to tests/inventory/kit-pieces.test.ts,
 * which covers the ratio arithmetic; this one covers the destructive
 * half — which lines get deleted, which get left alone, and which get
 * resized — because that is where a mistake costs real gear rather than
 * a wrong number on a quote.
 */

import {
  planKitReconcile,
  pickAnchorLine,
  type KitAction,
  type ManagedLine,
  type DesiredPiece,
} from '../../src/lib/orders/kitPlan'

const failures: string[] = []

function check(condition: unknown, message: string): void {
  if (!condition) failures.push(message)
  else console.log(`  ok — ${message}`)
}

function only<K extends KitAction['kind']>(actions: KitAction[], kind: K): Extract<KitAction, { kind: K }>[] {
  return actions.filter((a): a is Extract<KitAction, { kind: K }> => a.kind === kind)
}

const BATTERY_KIT = 'kit-battery'
const BANK_KIT = 'kit-bank'

function managed(over: Partial<ManagedLine> = {}): ManagedLine {
  return {
    id: 'line-batt',
    autoKitPieceId: BATTERY_KIT,
    quantity: 6,
    parentLineItemId: 'line-radio',
    pickStatus: 'PENDING_PICK',
    ...over,
  }
}

function want(over: Partial<DesiredPiece> = {}): DesiredPiece {
  return { kitPieceId: BATTERY_KIT, quantity: 6, anchorLineId: 'line-radio', ...over }
}

console.log('\nNothing configured, nothing on the order')
check(planKitReconcile([], []).length === 0, 'no kits and no managed lines is a no-op')

console.log('\nFirst add — the accessory does not exist yet')
{
  const actions = planKitReconcile([], [want()])
  const creates = only(actions, 'create')
  check(actions.length === 1 && creates.length === 1, 'one create, nothing else')
  check(creates[0].quantity === 6, 'created at the derived quantity')
  check(creates[0].anchorLineId === 'line-radio', 'nested under the radios that pulled it in')
}

console.log('\nQuantity edit — the parent count moved')
{
  const actions = planKitReconcile([managed({ quantity: 6 })], [want({ quantity: 3 })])
  const resizes = only(actions, 'resize')
  check(resizes.length === 1, 'a resize, not a delete-and-recreate')
  check(resizes[0].from === 6 && resizes[0].to === 3, '6 → 3')
  check(only(actions, 'remove').length === 0, 'nothing is removed on a resize')
}

console.log('\nNo change — the common save')
check(
  planKitReconcile([managed()], [want()]).length === 0,
  'same quantity and same parent produces no writes at all',
)

console.log('\nParent removed — the accessory goes with it')
{
  const actions = planKitReconcile([managed()], [])
  const removes = only(actions, 'remove')
  check(removes.length === 1 && removes[0].lineId === 'line-batt', 'the battery line is removed')
  check(removes[0].quantity === 6, 'the removal reports what was on the line')
}

console.log('\nAlready picked — a no-longer-owed piece is KEPT')
{
  for (const status of ['PICKED', 'STAGED', 'LOADED', 'RETURNED', 'SHORT']) {
    const actions = planKitReconcile([managed({ pickStatus: status })], [])
    check(
      only(actions, 'remove').length === 0 && only(actions, 'keep-picked').length === 1,
      `${status} is kept, not deleted — that gear physically left the building`,
    )
  }
  // The shelf case is the one that IS safe to delete.
  for (const status of [null, 'PENDING_PICK']) {
    const actions = planKitReconcile([managed({ pickStatus: status })], [])
    check(
      only(actions, 'remove').length === 1,
      `${status ?? 'null'} is still on the shelf, so it is removed`,
    )
  }
}

console.log('\nRe-nesting — the biggest parent line changed')
{
  const actions = planKitReconcile(
    [managed({ parentLineItemId: 'line-analog' })],
    [want({ anchorLineId: 'line-digital' })],
  )
  const renests = only(actions, 'renest')
  check(renests.length === 1, 'a move, not a resize — the count did not change')
  check(renests[0].anchorLineId === 'line-digital', 'now hangs under the digital radios')
}

console.log('\nTwo kits for the same piece stay separate promises')
{
  // The same battery owed by two parents under DIFFERENT ratios is two
  // rows. Matching on the item instead of the kit row would collapse
  // them and silently halve what ships.
  const actions = planKitReconcile(
    [managed({ id: 'a', autoKitPieceId: BATTERY_KIT })],
    [want({ kitPieceId: BATTERY_KIT }), want({ kitPieceId: BANK_KIT, quantity: 1 })],
  )
  check(only(actions, 'create').length === 1, 'the unmatched kit row is created')
  check(only(actions, 'remove').length === 0, 'the matched one is untouched, not replaced')
}

console.log('\nAnchor choice — largest contributor wins')
{
  const lines = [
    { id: 'line-analog', inventoryItemId: 'radio-analog', quantity: 20 },
    { id: 'line-digital', inventoryItemId: 'radio-digital', quantity: 2 },
  ]
  check(
    pickAnchorLine(['radio-analog', 'radio-digital'], lines) === 'line-analog',
    '20 analog + 2 digital → the bank hangs under the twenty',
  )
  check(
    pickAnchorLine(['radio-digital'], lines) === 'line-digital',
    'a piece owed only by the digital radios hangs under those',
  )
  check(
    pickAnchorLine(['radio-nonexistent'], lines) === null,
    'no matching parent line leaves the accessory unnested rather than guessing',
  )
  check(
    pickAnchorLine(['radio-analog'], [{ id: 'x', inventoryItemId: null, quantity: 99 }]) === null,
    'a line with no catalog binding can never be an anchor',
  )
}

console.log('\nManaged line whose kit row was deleted from the catalog')
{
  // autoKitPieceId is SetNull on delete, so the line arrives here with a
  // null id filtered out by the caller. If one DOES arrive with an id
  // nothing wants, it is treated as no-longer-owed — same as any other.
  const actions = planKitReconcile([managed({ autoKitPieceId: 'kit-gone' })], [want()])
  check(only(actions, 'remove').length === 1, 'the orphaned line is removed')
  check(only(actions, 'create').length === 1, 'and the still-owed piece is created')
}

console.log('')
if (failures.length > 0) {
  console.error(`FAILED (${failures.length}):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All kit-reconcile tests passed.')
