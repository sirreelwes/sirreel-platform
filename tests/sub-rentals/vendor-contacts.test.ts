/**
 * The people at a partner — validation and the two flags.
 *
 *   npm run test:vendor-contacts
 *
 * Pure + offline. Wes 2026-09-11: "I need to be able to add people on the
 * partner portal. owners and others. let's have a contacts section" — with a
 * per-person booking-email toggle that is OFF unless someone turns it on, so a
 * name added for reference never starts receiving booking traffic.
 */
import { cleanContactInput, contactRoleLabel, isVendorContactRole, looksLikeEmail, VENDOR_CONTACT_ROLES } from '../../src/lib/sub-rentals/vendorContacts'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else failures.push(`${why}: got ${g}, wanted ${w}`)
}
const ok = (r: ReturnType<typeof cleanContactInput>) => (r.ok ? r.value : null)
const err = (r: ReturnType<typeof cleanContactInput>) => (r.ok ? null : r.error)

console.log('Roles')
eq(VENDOR_CONTACT_ROLES.map((r) => r.key), ['OWNER', 'ACCOUNTING', 'DISPATCH', 'SALES', 'OPERATIONS', 'OTHER'], 'the list Wes asked for: owners and others')
eq(isVendorContactRole('OWNER'), true, 'OWNER is a role')
eq(isVendorContactRole('owner'), false, 'lowercase is not')
eq(contactRoleLabel('ACCOUNTING'), 'Accounting', 'labels read as words')
eq(contactRoleLabel('NONSENSE'), 'Other', 'an unknown role reads as Other')

console.log('What a person must have')
eq(err(cleanContactInput({ email: 'vic@vsmplanetrentals.com' })), 'Give the person a name.', 'a name is required')
eq(ok(cleanContactInput({ name: '  Vic Hartounian  ' }))?.name, 'Vic Hartounian', 'the name is trimmed')
eq(ok(cleanContactInput({ name: 'Vic', email: 'VIC@VSMPlanetRentals.com' }))?.email, 'vic@vsmplanetrentals.com', 'the address is lowercased')
eq(ok(cleanContactInput({ name: 'Vic' }))?.email, null, 'a person with no email is fine')
eq(err(cleanContactInput({ name: 'Vic', email: 'vic@vsmplanet' })), '“vic@vsmplanet” doesn’t look like an email address.', 'a typo is caught before it becomes mail nobody gets')
eq(looksLikeEmail('a@b.co'), true, 'a workable address passes')
eq(looksLikeEmail('a@b'), false, 'no dot, no good')

console.log('The two flags')
eq(ok(cleanContactInput({ name: 'Vic' }))?.emailBookings, false, 'booking mail is OFF unless asked for')
eq(ok(cleanContactInput({ name: 'Vic' }))?.isPrimary, false, 'nobody is the main contact by accident')
eq(ok(cleanContactInput({ name: 'Vic', email: 'vic@vsm.com', emailBookings: true }))?.emailBookings, true, 'ticking it with an address works')
eq(err(cleanContactInput({ name: 'Vic', emailBookings: true })), 'Add an email address before asking us to copy them on bookings.', 'no address, no booking mail')
eq(err(cleanContactInput({ name: 'Vic', isPrimary: true })), 'The main contact needs an email address — that is where partner mail goes.', 'the main contact must be reachable')
eq(ok(cleanContactInput({ name: 'Vic', email: 'vic@vsm.com', role: 'OWNER', isPrimary: true }))?.role, 'OWNER', 'a known role is kept')
eq(ok(cleanContactInput({ name: 'Vic', email: 'vic@vsm.com', role: 'CEO' }))?.role, 'OTHER', 'an unknown role falls back to Other')

if (failures.length) {
  console.error(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\nall partner-contact checks passed')
