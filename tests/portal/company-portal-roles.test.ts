/**
 * The titles on a production company's portal.
 *
 *   npx tsx tests/portal/company-portal-roles.test.ts
 *   npm run test:company-portal-roles
 *
 * Pure + offline. The registry is checked against the Prisma enum BOTH
 * ways, which is the thing that makes adding a title safe:
 *
 *   a value with no entry here → the client's portal renders a raw
 *     EXECUTIVE_PRODUCER under somebody's name
 *   an entry with no value → the CRM offers a title that cannot be saved,
 *     and the rep finds out at the insert
 *
 * Either one fails HERE instead, on a laptop, before a deploy.
 */

import { CompanyPortalRole } from '@prisma/client'
import {
  COMPANY_PORTAL_ROLE_SPECS,
  COMPANY_PORTAL_ROLE_VALUES,
  COMPANY_PORTAL_ROLE_OPTIONS,
  companyPortalRoleLabel,
  companyPortalRoleStaffLabel,
} from '../../src/lib/portal/companyPortalRoles'

const failures: string[] = []

function eq(got: unknown, want: unknown, why: string): void {
  if (got === want) console.log(`  ok — ${why}`)
  else failures.push(`${why}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

console.log('Every enum value has a title, and every title has a value\n')

const enumValues = Object.values(CompanyPortalRole) as string[]
for (const v of enumValues) {
  const spec = COMPANY_PORTAL_ROLE_SPECS.find((r) => r.value === v)
  if (spec) console.log(`  ok — ${v} → "${spec.label}"`)
  else failures.push(`${v} is in the Prisma enum with no entry in COMPANY_PORTAL_ROLE_SPECS`)
}
for (const spec of COMPANY_PORTAL_ROLE_SPECS) {
  if (!enumValues.includes(spec.value)) {
    failures.push(
      `"${spec.label}" (${spec.value}) is in the registry but not in the Prisma enum — ` +
      'add it to schema.prisma and run scripts/add-company-portal-role.ts',
    )
  }
}
eq(COMPANY_PORTAL_ROLE_VALUES.length, enumValues.length, 'no duplicates or gaps')

// A blank label would render as nothing at all beside someone's name.
for (const spec of COMPANY_PORTAL_ROLE_SPECS) {
  if (!spec.label.trim()) failures.push(`${spec.value} has a blank client label`)
  if (spec.staffLabel !== undefined && !spec.staffLabel.trim()) {
    failures.push(`${spec.value} has a blank staff label`)
  }
}

console.log('\nWes 2026-09-18 — the rename, and what it did NOT touch\n')

eq(companyPortalRoleLabel('EXECUTIVE'), 'Executive Producer', 'EXECUTIVE reads Executive Producer')
eq(companyPortalRoleStaffLabel('EXECUTIVE'), 'Executive Producer', 'and the same word to staff')
eq(companyPortalRoleLabel('HEAD_OF_PRODUCTION'), 'Head of Production', 'Head of Production unchanged')
eq(companyPortalRoleLabel('FINANCE'), 'Finance', 'Finance unchanged')

// The one role whose two audiences genuinely differ. A person logging in
// to read "Other" under their own name is being told what we could not be
// bothered to call them.
eq(companyPortalRoleLabel('OTHER'), 'Team', 'the client reads Team')
eq(companyPortalRoleStaffLabel('OTHER'), 'Other', 'the rep picks Other')

// The stored VALUE never moved — this was a rename of what it is called,
// so nothing has to be migrated and no existing grant changes meaning.
eq(COMPANY_PORTAL_ROLE_VALUES.includes(CompanyPortalRole.EXECUTIVE), true, 'EXECUTIVE is still the stored value')

console.log('\nFallbacks\n')

// An unknown value can only arrive from a database ahead of this deploy.
// Showing the raw value is ugly; showing nothing is worse — a person with
// no title would render as a bare name with a dangling separator.
eq(companyPortalRoleLabel('SOMETHING_NEW'), 'SOMETHING_NEW', 'an unknown value shows itself, never blank')
eq(companyPortalRoleStaffLabel('SOMETHING_NEW'), 'SOMETHING_NEW', 'same on the staff side')

console.log('\nThe CRM picker\n')

eq(COMPANY_PORTAL_ROLE_OPTIONS.length, enumValues.length, 'every role is offered')
eq(COMPANY_PORTAL_ROLE_OPTIONS[0].value, 'EXECUTIVE', 'Executive Producer leads the list')
eq(
  COMPANY_PORTAL_ROLE_OPTIONS.find((o) => o.value === 'OTHER')?.label,
  'Other',
  'the picker uses the staff word',
)

console.log('')
if (failures.length) {
  console.error(`FAILED (${failures.length}):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All company-portal-role cases passed.')
