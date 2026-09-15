/**
 * What type a line is stored as, whichever door it came in through.
 *
 *   npx tsx tests/orders/line-type.test.ts
 *   npm run test:line-type
 *
 * Pure + offline: no DB, no AI, no env.
 *
 * The bug this pins (2026-09-14): a stage line's stored `type` depended on
 * the door. MakeReservationModal posted VEHICLE for every asset-category
 * row — its picker serves VEHICLES and STAGES both — and the order page's
 * row editor re-derived EQUIPMENT from the catalog binding on the next
 * save. S260914-007's "Lankershim Studios" row read VEHICLE until Wes
 * saved it. `type === 'VEHICLE'` is what several surfaces read to decide
 * which controls a row gets, so the same row offered different controls on
 * different days.
 *
 * The other direction matters just as much: this rule must NOT re-derive
 * VEHICLE from the department. Two live catalog rows still carry VEHICLE
 * under PRO_SUPPLIES from the department re-flattening.
 */

import { resolveLineType } from '../../src/lib/orders/lineType'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

console.log('Line type resolution\n')

// ── The stage rule ───────────────────────────────────────────────────────
check(
  'a stage picked in the reservation modal is EQUIPMENT, not VEHICLE',
  resolveLineType('ASSET_CATEGORY', 'STAGES') === 'EQUIPMENT',
)
check(
  'the same stage re-saved from the order page row editor stays EQUIPMENT',
  resolveLineType('INVENTORY', 'STAGES') === 'EQUIPMENT',
)
check(
  'both doors agree on a stage',
  resolveLineType('ASSET_CATEGORY', 'STAGES') === resolveLineType('INVENTORY', 'STAGES'),
)
check(
  "CAT_STUDIOS's own catalog type (EQUIPMENT) is honoured",
  resolveLineType('INVENTORY', 'STAGES', 'EQUIPMENT') === 'EQUIPMENT',
)
check(
  'a catalog row that claims VEHICLE inside STAGES is still not a vehicle',
  resolveLineType('INVENTORY', 'STAGES', 'VEHICLE') === 'EQUIPMENT',
)
check(
  'an expendable re-departmented onto a stage order keeps EXPENDABLE',
  resolveLineType('INVENTORY', 'STAGES', 'EXPENDABLE') === 'EXPENDABLE',
)

// ── Everything else is byte-for-byte what it was ─────────────────────────
check(
  'a vehicle picked in the reservation modal is still VEHICLE',
  resolveLineType('ASSET_CATEGORY', 'VEHICLES') === 'VEHICLE',
)
check(
  'a vehicle catalog row wins over its department',
  resolveLineType('INVENTORY', 'VEHICLES', 'VEHICLE') === 'VEHICLE',
)
check(
  'a VEHICLE row left under PRO_SUPPLIES by the department re-flattening is NOT retyped',
  resolveLineType('INVENTORY', 'PRO_SUPPLIES', 'VEHICLE') === 'VEHICLE',
)
check(
  'an expendable department gives EXPENDABLE',
  resolveLineType('INVENTORY', 'EXPENDABLES') === 'EXPENDABLE',
)
check(
  'a gear row is EQUIPMENT',
  resolveLineType('INVENTORY', 'GE') === 'EQUIPMENT',
)
check(
  'a package is EQUIPMENT whatever the department says',
  resolveLineType('PACKAGE', 'STAGES') === 'EQUIPMENT'
    && resolveLineType('PACKAGE', 'VEHICLES') === 'EQUIPMENT',
)
check(
  'an unbound line falls through to EQUIPMENT',
  resolveLineType(null, 'PRO_SUPPLIES') === 'EQUIPMENT',
)

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All line-type checks passed.')
