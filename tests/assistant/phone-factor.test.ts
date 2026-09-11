/**
 * Sender-number factor tests.
 *
 *   npm run test:phone-factor
 *
 * The number a text came from can stand in for the job code when it is on
 * file for a driver or contact on a current job. The match is the one
 * place a formatting difference would silently deny a real driver, so the
 * cases are the ways numbers are actually typed into HQ.
 */
import { phoneOnFile, phoneTail } from '../../src/lib/assistant/phoneFactor'

let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`)
  else { failed++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

console.log('phoneTail')
check('E.164 → last ten digits', phoneTail('+18185152389') === '8185152389')
check('dashed, no country code', phoneTail('818-515-2389') === '8185152389')
check('parenthesised with spaces', phoneTail('(818) 515-2389') === '8185152389')
check('too short is null', phoneTail('515-2389') === null)
check('empty / null is null', phoneTail('') === null && phoneTail(null) === null)

console.log('phoneOnFile')
check('sender in E.164 matches a dashed number on file', phoneOnFile('+18185152389', ['818-515-2389']))
check('matches any of several candidates', phoneOnFile('+18185152389', [null, '(760) 672-5522', ' (818) 515-2389 ']))
check('a different number does not match', !phoneOnFile('+18185152389', ['818-515-2380']))
check('blank candidates never match', !phoneOnFile('+18185152389', [null, undefined, '']))
check('a short candidate never matches by suffix', !phoneOnFile('+18185152389', ['515-2389']))
check('no sender never matches', !phoneOnFile(null, ['818-515-2389']))

if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
console.log('\nall passing')
