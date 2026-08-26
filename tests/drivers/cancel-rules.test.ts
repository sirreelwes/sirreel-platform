/**
 * Who may un-name a driver, and when.
 *
 * The asymmetry is deliberate (Wes 2026-08-25): a CLIENT may cancel only a
 * pending driver, because pulling someone who already cleared a licence
 * check on pickup morning is how a truck ends up with nobody able to take
 * it. STAFF may also cancel a READY driver — they own the handover decision,
 * and without that a wrongly-named checked driver would be unfixable by
 * anyone. PICKED_UP is refused for both: the keys are gone and
 * CheckoutRecord is the authoritative record.
 *
 * Run: npm run test:driver-cancel
 */
import type { DriverAssignmentStatus } from '@prisma/client'

const CLIENT_CANCELLABLE: DriverAssignmentStatus[] = ['INVITED', 'VIEWED']
const clientMay = (s: DriverAssignmentStatus) => CLIENT_CANCELLABLE.includes(s)
const staffMay = (s: DriverAssignmentStatus) => s !== 'PICKED_UP' && s !== 'CANCELLED'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${got}${ok ? '' : ` (want ${want})`}`)
}

const ALL: DriverAssignmentStatus[] = ['INVITED', 'VIEWED', 'READY', 'PICKED_UP', 'CANCELLED']

console.log('CLIENT:')
eq('  INVITED   removable', clientMay('INVITED'), true)
eq('  VIEWED    removable', clientMay('VIEWED'), true)
eq('  READY     REFUSED  ', clientMay('READY'), false)
eq('  PICKED_UP REFUSED  ', clientMay('PICKED_UP'), false)

console.log('\nSTAFF:')
eq('  INVITED   removable', staffMay('INVITED'), true)
eq('  VIEWED    removable', staffMay('VIEWED'), true)
eq('  READY     removable', staffMay('READY'), true)
eq('  PICKED_UP REFUSED  ', staffMay('PICKED_UP'), false)

console.log('\nInvariants:')
// Anything a client may cancel, staff may cancel too — never the reverse.
eq('client ⊆ staff', ALL.every((s) => !clientMay(s) || staffMay(s)), true)
eq('nobody cancels PICKED_UP', !clientMay('PICKED_UP') && !staffMay('PICKED_UP'), true)
eq('staff strictly wider', ALL.some((s) => staffMay(s) && !clientMay(s)), true)

/**
 * Cancelling a BOOKING releases its drivers (Wes 2026-08-26).
 *
 * Same PICKED_UP carve-out as the two DELETE endpoints, for the same
 * reason: those keys are already out. Everything else loses its token,
 * because that token is the driver's no-login access to the job page and
 * the gate code — releasing the units without expiring it left people able
 * to walk up to the yard for a booking that no longer exists, invisible
 * because the staff page filters cancelled bookings out entirely.
 */
const bookingCancelReleases = (s: DriverAssignmentStatus) => !['CANCELLED', 'PICKED_UP'].includes(s)

console.log('\nBOOKING CANCELLED releases:')
eq('  INVITED   released', bookingCancelReleases('INVITED'), true)
eq('  VIEWED    released', bookingCancelReleases('VIEWED'), true)
eq('  READY     released', bookingCancelReleases('READY'), true)
eq('  PICKED_UP LEFT ALONE', bookingCancelReleases('PICKED_UP'), false)
eq('  CANCELLED no-op    ', bookingCancelReleases('CANCELLED'), false)
// The booking sweep is the widest of the three, and still never touches
// a collected vehicle.
// The `|| s === 'CANCELLED'` guard this once carried was dead: staffMay
// already excludes CANCELLED, so TS narrowed it to an impossible compare.
eq('sweep ⊇ staff', ALL.every((s) => !staffMay(s) || bookingCancelReleases(s)), true)
eq('sweep spares PICKED_UP', !bookingCancelReleases('PICKED_UP'), true)

console.log(fail === 0 ? '\nall driver-cancel checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
