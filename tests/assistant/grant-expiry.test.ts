/**
 * Hand-made grant expiry tests.
 *
 *   npm run test:aha-grant-expiry
 *
 * Wes 2026-09-15, asked how a production contact loses code access once
 * they are off the job: every derived tier lapses on its own, but a row
 * added by hand on /admin/assistant used to last until a human revoked it.
 * What is pinned here: a grant dies on its own date, a contact's default
 * follows their job, "never" stays possible but has to be chosen, and a
 * typo'd far-future date is refused rather than quietly granting years.
 */
import {
  CONTACT_GRANT_TAIL_DAYS,
  DEFAULT_GRANT_DAYS,
  MAX_GRANT_DAYS,
  addDays,
  grantIsActive,
  resolveGrantExpiry,
} from '../../src/lib/assistant/grantExpiry'

let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`)
  else { failed++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

const NOW = new Date('2026-09-15T18:00:00Z')

console.log('grantIsActive')
check('no expiry, not revoked → active', grantIsActive({ revokedAt: null, expiresAt: null }, NOW))
check('expiry in the future → active', grantIsActive({ expiresAt: addDays(NOW, 1) }, NOW))
check('expiry in the past → lapsed', !grantIsActive({ expiresAt: addDays(NOW, -1) }, NOW))
check('revoked beats a future expiry', !grantIsActive({ revokedAt: NOW, expiresAt: addDays(NOW, 30) }, NOW))
check('revoked beats no expiry', !grantIsActive({ revokedAt: NOW, expiresAt: null }, NOW))

console.log('defaults')
const contactJobEnd = new Date('2026-09-20T00:00:00Z')
const c = resolveGrantExpiry({ requested: null, level: 'CONTACT', jobEnd: contactJobEnd, now: NOW })
check(
  `a contact follows their job + ${CONTACT_GRANT_TAIL_DAYS} days`,
  c.expiresAt?.toISOString().startsWith('2026-09-27') === true,
  c.expiresAt?.toISOString(),
)
const st = resolveGrantExpiry({ requested: null, level: 'STAFF', now: NOW })
check(
  `anyone else gets ${DEFAULT_GRANT_DAYS} days`,
  st.expiresAt?.toISOString().startsWith('2026-12-14') === true,
  st.expiresAt?.toISOString(),
)
const noJob = resolveGrantExpiry({ requested: null, level: 'CONTACT', jobEnd: null, now: NOW })
check('a contact with no job date falls back to the default', noJob.expiresAt !== null && !noJob.error)
check('no default is ever null — blank never means forever', [c, st, noJob].every((r) => r.expiresAt !== null))

console.log('explicit choices')
check('"never" is honored', resolveGrantExpiry({ requested: 'never', level: 'ADMIN', now: NOW }).expiresAt === null)
const pick = resolveGrantExpiry({ requested: new Date('2026-10-01T00:00:00Z'), level: 'STAFF', now: NOW })
check('a chosen date is kept', pick.expiresAt?.toISOString().startsWith('2026-10-01') === true)

console.log('refusals')
check('a past date is refused', Boolean(resolveGrantExpiry({ requested: addDays(NOW, -1), level: 'STAFF', now: NOW }).error))
check('today is refused (already lapsed)', Boolean(resolveGrantExpiry({ requested: NOW, level: 'STAFF', now: NOW }).error))
check('an unparseable date is refused', Boolean(resolveGrantExpiry({ requested: new Date('nope'), level: 'STAFF', now: NOW }).error))
check(
  `beyond ${MAX_GRANT_DAYS} days is refused, not silently granted`,
  Boolean(resolveGrantExpiry({ requested: addDays(NOW, MAX_GRANT_DAYS + 1), level: 'STAFF', now: NOW }).error),
)
check('a refusal never returns a usable date', resolveGrantExpiry({ requested: addDays(NOW, -5), level: 'STAFF', now: NOW }).expiresAt === null)

if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
console.log('\nall passing')
