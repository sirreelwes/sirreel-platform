/**
 * BookingStatus mirror + portal lock tests.
 *
 *   npx tsx tests/bookings/status.test.ts
 *   npm run test:booking-status
 *
 * The first test is the important one: src/lib/bookings/status.ts keeps
 * a hand-written copy of the enum because the client portal cannot
 * import @prisma/client. This asserts that copy against the REAL enum,
 * so adding a BookingStatus without updating the mirror fails here
 * instead of silently leaving a status unhandled in the portal.
 *
 * That is the exact failure this whole file exists to prevent: the
 * portal gated read-only mode on 'COMPLETE' and 'CLOSED', neither of
 * which has ever been a BookingStatus. Being a string `.includes()`
 * they were inert, so nothing ever complained.
 */

import { BookingStatus } from '@prisma/client'
import {
  BOOKING_STATUS_VALUES,
  portalLockReason,
  isPortalPaperworkLocked,
  type PortalLockReason,
} from '../../src/lib/bookings/status'

const failures: string[] = []

function check(cond: boolean, why: string): void {
  console.log(cond ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!cond) failures.push(why)
}

console.log('\nThe mirror matches the real Prisma enum')
{
  const real = [...Object.values(BookingStatus)].sort()
  const mirror = [...BOOKING_STATUS_VALUES].sort()
  const missing = real.filter((r) => !mirror.includes(r as never))
  const extra = mirror.filter((m) => !real.includes(m))
  check(missing.length === 0, `no enum value missing from the mirror${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`)
  check(extra.length === 0, `no invented value in the mirror${extra.length ? ` (extra: ${extra.join(', ')})` : ''}`)
}

console.log('\nEvery real status gets a deliberate lock decision')
for (const status of Object.values(BookingStatus)) {
  const reason = portalLockReason(status)
  check(
    reason === null || reason === 'settled' || reason === 'cancelled',
    `${status} → ${reason ?? 'open'}`,
  )
}

console.log('\nPaperwork stays OPEN while the booking can still be papered')
;(['REQUEST', 'AI_REVIEW', 'PENDING_APPROVAL'] as const).forEach((s) =>
  check(portalLockReason(s) === null, `${s} — this is the window the portal exists for`),
)
check(portalLockReason('CONFIRMED') === null,
  'CONFIRMED stays OPEN — Planyo/gantt holds carry CONFIRMED before any paperwork exists, and locking them is the portal refusing to do its only job (v2 ruling)')
check(portalLockReason('ACTIVE') === null,
  'ACTIVE stays OPEN for the same reason; signed docs lock themselves via their per-doc done state')

console.log('\nPaperwork LOCKS only once the rental is genuinely terminal')
;(['RETURNED', 'ARCHIVED'] as const).forEach((s) =>
  check(portalLockReason(s) === 'settled', `${s} — editing would change the record behind a rental that already happened`),
)

console.log('\nCancelled locks, but for its own reason')
check(portalLockReason('CANCELLED') === 'cancelled',
  'CANCELLED is not "settled" — telling a client "this rental has been confirmed" would be false')

console.log('\nThe values that were never real')
;(['COMPLETE', 'CLOSED'] as const).forEach((s) =>
  check(portalLockReason(s) === null, `${s} has never been a BookingStatus and no longer appears anywhere`),
)

console.log('\nUnknown input fails OPEN, never closed')
check(portalLockReason(null) === null, 'null → open')
check(portalLockReason(undefined) === null, 'undefined → open')
check(portalLockReason('') === null, 'empty string → open')
check(portalLockReason('SOMETHING_NEW') === null,
  'an unrecognised status must not silently shut a client out of paperwork they still owe us')

console.log('\nThe boolean convenience agrees with the reason')
check(isPortalPaperworkLocked('RETURNED') === true, 'RETURNED is locked')
check(isPortalPaperworkLocked('CONFIRMED') === false, 'CONFIRMED is not')

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):\n`)
  failures.forEach((f) => console.error(`  - ${f}`))
  process.exit(1)
}
console.log('\nAll booking-status tests passed.\n')

// Keeps the type import honest — a PortalLockReason that stops being a
// union of exactly these two would fail to compile here.
const _exhaustive: PortalLockReason[] = ['settled', 'cancelled']
void _exhaustive
