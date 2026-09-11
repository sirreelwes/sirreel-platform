/**
 * Owners' tier tests (the pure parts).
 *
 *   npm run test:aha-owners
 *
 * What is pinned: the allowlist comes from AHA_OWNER_EMAILS and is Wes alone
 * when unset; matching is case- and whitespace-insensitive; docs/owners/ is
 * recognised as the owners' folder and nothing else is; and — the part that
 * keeps the succession notes private — the signed-in identity is an owner
 * only when BOTH the admin level and the email line up.
 */
import { isOwnerEmail, isOwnersPath, ownerEmails } from '../../src/lib/assistant/owners'
import { identityForUser } from '../../src/lib/assistant/senderIdentity'

let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`)
  else { failed++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

console.log('allowlist')
check('unset → Wes alone', JSON.stringify(ownerEmails(undefined)) === JSON.stringify(['wes@sirreel.com']))
check('empty string → Wes alone', JSON.stringify(ownerEmails('  ')) === JSON.stringify(['wes@sirreel.com']))
check('comma list, trimmed and lowercased', JSON.stringify(ownerEmails(' Wes@SirReel.com , second@sirreel.com ')) === JSON.stringify(['wes@sirreel.com', 'second@sirreel.com']))
check('duplicates collapse', ownerEmails('a@sirreel.com,a@sirreel.com').length === 1)
check('a bare word is not an email', JSON.stringify(ownerEmails('nobody')) === JSON.stringify(['wes@sirreel.com']))

console.log('isOwnerEmail')
check('listed email matches regardless of case', isOwnerEmail('SECOND@sirreel.com', 'wes@sirreel.com,second@sirreel.com'))
check('unlisted admin is not an owner', !isOwnerEmail('dani@sirreel.com', 'wes@sirreel.com,second@sirreel.com'))
check('null email is not an owner', !isOwnerEmail(null, 'wes@sirreel.com'))

console.log('owners folder')
check('docs/owners/succession.md is owners-only', isOwnersPath('docs/owners/succession.md'))
check('the folder itself is owners-only', isOwnersPath('docs/owners'))
check('docs/owners-guide.md is NOT (prefix must be the folder)', !isOwnersPath('docs/owners-guide.md'))
check('docs/aha/aha-for-staff.md is not', !isOwnersPath('docs/aha/aha-for-staff.md'))
check('CLAUDE.md is not', !isOwnersPath('CLAUDE.md'))
check('windows separators normalise', isOwnersPath('docs\\owners\\succession.md'))

console.log('signed-in identity')
const prev = process.env.AHA_OWNER_EMAILS
process.env.AHA_OWNER_EMAILS = 'wes@sirreel.com,second@sirreel.com'
try {
  const owner = identityForUser({ id: 'u1', name: 'Second Person', role: 'ADMIN', email: 'second@sirreel.com' })
  check('ADMIN on the list → owner', owner.owner && owner.level === 'admin')
  const admin = identityForUser({ id: 'u2', name: 'Dani', role: 'ADMIN', email: 'dani@sirreel.com' })
  check('ADMIN off the list → admin, not owner', admin.level === 'admin' && !admin.owner)
  const mgr = identityForUser({ id: 'u3', name: 'Second Person', role: 'MANAGER', email: 'second@sirreel.com' })
  check('listed email at MANAGER → staff, not owner', mgr.level === 'staff' && !mgr.owner)
  const noEmail = identityForUser({ id: 'u4', name: 'Wes', role: 'ADMIN' })
  check('no email given → not owner', !noEmail.owner)
} finally {
  if (prev === undefined) delete process.env.AHA_OWNER_EMAILS
  else process.env.AHA_OWNER_EMAILS = prev
}

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1) }
console.log('\nall owners checks passed')
