/**
 * Company-selection sentinel tests.  npm run test:company-sentinels
 *
 * These exist for one bug shape. The Review Quote form holds its company
 * choice in a string that is usually a Company id and sometimes an
 * answer. When '__unknown__' was added alongside '__new__', one of the
 * four inline `!== '__new__'` checks was written as
 *
 *     job.company?.id ?? selectedClientId
 *
 * which passes the sentinel straight through, because `??` only falls
 * through on null and '__unknown__' is a perfectly good string. The
 * literal text '__unknown__' would then have been sent to the API as a
 * company id.
 */

import {
  COMPANY_SENTINEL_NEW, COMPANY_SENTINEL_UNKNOWN,
  isUnknownCompany, realCompanyId,
} from '../../src/lib/companies/pickerSentinels'

const failures: string[] = []
const check = (c: boolean, why: string) => {
  console.log(c ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!c) failures.push(why)
}

console.log('A real id passes through untouched')
check(realCompanyId('c7f3a1e2-0000-4000-8000-000000000001') === 'c7f3a1e2-0000-4000-8000-000000000001',
  'a uuid is returned as-is')

console.log('\nNeither sentinel can reach an API')
check(realCompanyId(COMPANY_SENTINEL_NEW) === null, "'__new__' becomes null")
check(realCompanyId(COMPANY_SENTINEL_UNKNOWN) === null, "'__unknown__' becomes null")
check(realCompanyId('') === null, 'empty becomes null')
check(realCompanyId(null) === null, 'null stays null')
check(realCompanyId(undefined) === null, 'undefined becomes null')

console.log('\nThe ?? trap that caused this module to exist')
{
  // The exact expression from the save path, with a job that has no
  // company of its own and a rep who said "I don't know it yet".
  const jobCompanyId: string | null = null
  const selected = COMPANY_SENTINEL_UNKNOWN
  const wrong = jobCompanyId ?? selected
  const right = jobCompanyId ?? realCompanyId(selected)
  check(wrong === '__unknown__',
    "?? on the raw value yields the literal '__unknown__' — this is the bug")
  check(right === null,
    'routed through realCompanyId it yields null, so the caller must handle it')
}

console.log('\n"I don\'t know" is distinguishable from "nothing chosen"')
check(isUnknownCompany(COMPANY_SENTINEL_UNKNOWN), "'__unknown__' reads as unknown")
check(!isUnknownCompany(''), 'an empty selection is NOT the same as saying you do not know')
check(!isUnknownCompany(COMPANY_SENTINEL_NEW), "'__new__' is not unknown either")
check(!isUnknownCompany('c7f3a1e2-0000-4000-8000-000000000001'), 'a real id is not unknown')

console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll picker-sentinel tests passed.')
process.exitCode = failures.length ? 1 : 0
