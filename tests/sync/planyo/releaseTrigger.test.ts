/**
 * Belt-test: Planyo cancellation detection.
 *
 * Three real Planyo `get_reservation_data` responses, captured 2026-06-18:
 *   - reservation-19710795.json — the LOTUMN Camera Cube (cart 5640555),
 *     cancelled by Jose via Planyo UI on 2026-06-15 15:43:28 PT. Confirmed
 *     CURRENT cancelled.
 *   - reservation-19710796.json — the LOTUMN Cube Truck #20 on the same
 *     cart. Active control: never cancelled.
 *   - reservation-19646614.json — sampled from a 200-row scan; carries an
 *     historical `event === '2'` in log_events but is currently confirmed
 *     (reinstated). Proves log_events alone is unsafe as a current-state
 *     signal.
 *
 * Run:  npx tsx tests/sync/planyo/releaseTrigger.test.ts
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { isReservationCancelled } from '../../../src/lib/sync/planyo/reconcile'
import type { PlanyoLine } from '../../../src/lib/sync/planyo/planyoClient'

function load(name: string): PlanyoLine {
  const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'))
  return raw.data as PlanyoLine
}

const failures: string[] = []
function eq(actual: unknown, expected: unknown, label: string): void {
  if (actual === expected) console.log(`  ok — ${label}`)
  else failures.push(`${label}\n    got:      ${JSON.stringify(actual)}\n    expected: ${JSON.stringify(expected)}`)
}

const lotumnCancelled = load('reservation-19710795.json')
const lotumnActive = load('reservation-19710796.json')
const reinstated = load('reservation-19646614.json')
// Kevin Tighe / Concrete: brand-new cart 5650000, booked + cancelled
// same day (2026-06-18). Proves the CREATE-path bug — if the sync had
// processed this cart in-scope before the CREATE-probe pass landed, it
// would have written a self-made phantom hold. Used here for the
// CREATE-path regression test.
const concrete = load('reservation-19744876.json')

console.log('Cancellation detection — current state, not history')

// 1. The belt-test reservation: real cancellation, must detect as cancelled.
eq(isReservationCancelled(lotumnCancelled), true, '19710795 LOTUMN Camera Cube (cancelled today) → detected as cancelled')
eq(lotumnCancelled.user_text, 'This reservation has been cancelled by the administrator.', '19710795 user_text matches expected admin-cancel string')
eq(
  (lotumnCancelled.log_events ?? []).some((e) => String(e.event) === '2'),
  true,
  '19710795 log_events carries event=2 (corroborating)',
)

// 2. Active control: must NOT be detected as cancelled.
eq(isReservationCancelled(lotumnActive), false, '19710796 LOTUMN Cube Truck #20 (active) → NOT cancelled')
eq(lotumnActive.user_text, 'Your reservation is now confirmed.', '19710796 user_text is "now confirmed"')
eq(
  (lotumnActive.log_events ?? []).some((e) => String(e.event) === '2'),
  false,
  '19710796 log_events has NO event=2',
)

// 3. Reinstatement case: log_events carries historical event=2 but
//    user_text says confirmed. Detector must return FALSE.
eq(isReservationCancelled(reinstated), false, '19646614 (reinstated; historical event=2 in log) → NOT cancelled')
eq(reinstated.user_text, 'Your reservation is now confirmed.', '19646614 user_text shows confirmed (not cancelled)')
eq(
  (reinstated.log_events ?? []).some((e) => String(e.event) === '2'),
  true,
  '19646614 log_events DOES carry event=2 (historical) — this is exactly why event=2 cannot be the trigger',
)

// 4. Status-code anti-test: the deprecated check would have returned
//    false on the LOTUMN cancellation (status is 11, not 2). Capture
//    this so any future regression is loud.
eq(parseInt(String(lotumnCancelled.status), 10) === 2, false, 'status===2 fails on a real cancellation (status is 11) — deprecated check confirmed wrong')

// 5. CREATE-path regression — Concrete / Kevin Tighe (resv 19744876).
//    Booked 2026-06-18, pickup 6/19, cancelled the same day. Without
//    the CREATE-probe pass, the sync would have written this as a new
//    Reservation + BookingItem (a self-made phantom), because the
//    bulk pull data does NOT carry user_text. The fix calls
//    `get_reservation_data` per CREATE candidate and demotes the line
//    to SKIP_CANCELLED_NEW when `isReservationCancelled` is true.
eq(isReservationCancelled(concrete), true, '19744876 Concrete / Kevin Tighe (cancelled today) → detected as cancelled')
eq(concrete.user_text, 'This reservation has been cancelled by the administrator.', '19744876 user_text matches the admin-cancel string')
eq(parseInt(String(concrete.status), 10) === 2, false, '19744876 status is NOT 2 — proves the bulk-pull status check would have missed this')

if (failures.length) {
  console.error('\nFAIL — ' + failures.length + ' failure(s):')
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}
console.log('\nAll release-trigger tests passed.')
