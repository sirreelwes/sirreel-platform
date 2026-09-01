/**
 * HQ-native vs imported.  npm run test:provenance
 *
 * Wes, 2026-09-01: natively-created work "may sneak up on people or get
 * missed" because it is one row in six on a list dominated by imports.
 * Getting this predicate wrong in the FALSE-NATIVE direction is the
 * expensive one: it puts an "ours to run" badge on a job Planyo is
 * already handling, which is how the badge stops being believed.
 */

import { isNativeToHq, jobOrigin, ORIGIN_LABEL } from '../../src/lib/provenance'

const failures: string[] = []
const check = (c: boolean, why: string) => {
  console.log(c ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!c) failures.push(why)
}

console.log('A Planyo cart id is proof of an import')
check(!isNativeToHq({ planyoCartId: '5777483', source: 'AGENT_DIRECT' }),
  'cartId wins over an innocent-looking source — the REAL case: booking ' +
  'SR-Q-1788206125184 carries cartId 5777483 and source AGENT_DIRECT, and ' +
  'reading the enum alone called it native')
check(!isNativeToHq({ planyoCartId: '1', source: null }), 'cartId alone is enough')

console.log('\nThe backfill source is an import too')
check(!isNativeToHq({ planyoCartId: null, source: 'PLANYO_BACKFILL' }),
  'PLANYO_BACKFILL with no cartId is still not ours')

console.log('\nReal HQ work is native')
for (const source of ['AGENT_DIRECT', 'PHONE', 'EMAIL', 'WEBSITE', 'AI_AUTO']) {
  check(isNativeToHq({ planyoCartId: null, source }), `${source} with no cart id is native`)
}
check(isNativeToHq({}), 'a row with neither field is native — orders have no cart id at all')
check(isNativeToHq({ planyoCartId: '', source: null }),
  'an EMPTY cartId is not an import — only a real cart id is')

console.log('\nJob origin picks one label')
check(jobOrigin({ planyoCartId: '5777483' }) === 'PLANYO', 'a cart id reads Planyo')
check(jobOrigin({ source: 'PLANYO_BACKFILL' }) === 'PLANYO', 'so does the backfill source')
check(jobOrigin({ hasRwLink: true }) === 'RENTALWORKS', 'an RW link with no import reads RentalWorks')
check(jobOrigin({}) === 'HQ', 'neither reads HQ')
check(jobOrigin({ planyoCartId: '1', hasRwLink: true }) === 'PLANYO',
  'import wins over the RW link — what matters is that HQ is not the system of record')

console.log('\nLabels exist for every origin')
check(ORIGIN_LABEL.HQ === 'HQ' && !!ORIGIN_LABEL.PLANYO && !!ORIGIN_LABEL.RENTALWORKS,
  'all three are labelled')

console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll provenance tests passed.')
process.exitCode = failures.length ? 1 : 0
