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

// ── The gap this file had until 2026-09-19 ───────────────────────────────
// Nothing pinned what an INVENTORY row under VEHICLES answers with NO
// catalog type, and the answer is EQUIPMENT — correct as a rule (department
// must not mint VEHICLE; see the PRO_SUPPLIES case above) and catastrophic
// as a default, because two callers were reaching it for real trucks:
// the order page's row editor passed no third argument at all, so every
// catalog-bound van flipped to EQUIPMENT the first time anyone saved an
// edit; and the "+ Add Item" form left its EQUIPMENT default standing when
// a van was picked out of the Search Inventory box. Vehicles have been
// InventoryItem rows since the department flattening, so both were ordinary
// paths, not edge cases. The rule is unchanged — the fix was to SUPPLY the
// catalog row's type at both doors, and to re-derive it server-side in the
// line-item POST/PUT so no future door can forget.
check(
  'an INVENTORY row with no catalog type falls through to EQUIPMENT — even under VEHICLES',
  resolveLineType('INVENTORY', 'VEHICLES') === 'EQUIPMENT',
)
check(
  'so a vehicle is only VEHICLE when the catalog row is actually read',
  resolveLineType('INVENTORY', 'VEHICLES') !== resolveLineType('INVENTORY', 'VEHICLES', 'VEHICLE'),
)
check(
  'the legacy vehicle-class binding still answers VEHICLE without one',
  resolveLineType('ASSET_CATEGORY', 'VEHICLES') === 'VEHICLE',
)
check(
  'a per-vehicle FEE row under VEHICLES stays a FEE, so department is never the answer',
  resolveLineType('INVENTORY', 'VEHICLES', 'FEE') === 'FEE',
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
