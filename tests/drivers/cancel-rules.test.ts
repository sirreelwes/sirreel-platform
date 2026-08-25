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

console.log(fail === 0 ? '\nall driver-cancel checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
