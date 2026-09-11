/**
 * AHA access-level tests.
 *
 *   npm run test:aha-access
 *
 * Wes 2026-09-11: people get from AHA "whatever they can from whatever
 * role they have in HQ", plus a way to add and subtract people by hand.
 * These pin the resolution order — a BLOCKED grant beats everything, a
 * hand-made grant beats the HQ role, the role beats being a contact — and
 * the role → level mapping (ADMIN is the only role with the memory).
 */
import { atLeast, LEVEL_CAPABILITIES, levelForRole, levelFromGrant, resolveLevel } from '../../src/lib/assistant/access'

let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`)
  else { failed++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

console.log('levelForRole')
check('ADMIN → admin', levelForRole('ADMIN') === 'admin')
check('MANAGER, AGENT, BILLING → staff', ['MANAGER', 'AGENT', 'BILLING'].every((r) => levelForRole(r) === 'staff'))
check('unknown / missing role → public', levelForRole('VIEWER') === 'public' && levelForRole(null) === 'public')
check('case-insensitive', levelForRole('admin') === 'admin')

console.log('resolveLevel')
check('nothing → public', resolveLevel({}) === 'public')
check('contact only → contact', resolveLevel({ isContact: true }) === 'contact')
check('HQ role beats contact', resolveLevel({ userRole: 'AGENT', isContact: true }) === 'staff')
check('ADMIN role → admin', resolveLevel({ userRole: 'ADMIN' }) === 'admin')
check('hand-made STAFF grant with no HQ account → staff', resolveLevel({ grantLevel: 'staff' }) === 'staff')
check('hand-made ADMIN grant → admin', resolveLevel({ grantLevel: 'admin' }) === 'admin')
check('hand-made CONTACT grant on an HQ user takes staff tools away', resolveLevel({ grantLevel: 'contact', userRole: 'AGENT' }) === 'contact')
check('BLOCKED beats an ADMIN role', resolveLevel({ grantLevel: 'blocked', userRole: 'ADMIN', isContact: true }) === 'blocked')

console.log('helpers')
check('atLeast orders blocked < public < contact < staff < admin', atLeast('admin', 'staff') && atLeast('staff', 'staff') && !atLeast('contact', 'staff') && !atLeast('blocked', 'public'))
check('levelFromGrant maps the DB enum', levelFromGrant('BLOCKED') === 'blocked' && levelFromGrant('ADMIN') === 'admin' && levelFromGrant('weird') === 'public')
check('every level has a legend entry', (['blocked', 'public', 'contact', 'staff', 'admin'] as const).every((l) => LEVEL_CAPABILITIES[l].can.length > 0))
check('only admin lists the platform memory', LEVEL_CAPABILITIES.admin.can.some((c) => /memory/i.test(c)) && !LEVEL_CAPABILITIES.staff.can.some((c) => /memory/i.test(c)))

if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
console.log('\nall passing')
