/**
 * Greeting-by-name tests.
 *
 *   npm run test:greeting
 *
 * Wes 2026-09-11: greet a known contact by first name the first time they
 * reach out, do not overuse it, and work it in again after an hour or more
 * of silence. The route decides the moment from the thread's timestamps
 * BEFORE the new inbound is recorded; these pin the boundaries and the
 * prompt text the model is handed, so "personal" is a rule, not a mood.
 */
import { firstNameOf, greetingInstruction, greetingMoment, RETURNING_AFTER_MS } from '../../src/lib/assistant/greeting'

let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`)
  else { failed++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

const now = new Date('2026-09-11T20:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)
const MIN = 60 * 1000

console.log('greetingMoment')
check('no history at all → first', greetingMoment({ lastInboundAt: null, lastOutboundAt: null }, now) === 'first')
check('last message 5 minutes ago → none', greetingMoment({ lastInboundAt: ago(5 * MIN), lastOutboundAt: ago(4 * MIN) }, now) === 'none')
check('last message 59 minutes ago → none', greetingMoment({ lastInboundAt: ago(59 * MIN), lastOutboundAt: null }, now) === 'none')
check('exactly an hour → returning', greetingMoment({ lastInboundAt: ago(RETURNING_AFTER_MS), lastOutboundAt: null }, now) === 'returning')
check('a day later → returning', greetingMoment({ lastInboundAt: ago(24 * 60 * MIN), lastOutboundAt: ago(24 * 60 * MIN) }, now) === 'returning')
check('the most recent of inbound/outbound is what counts', greetingMoment({ lastInboundAt: ago(3 * 60 * MIN), lastOutboundAt: ago(10 * MIN) }, now) === 'none')
check('an outbound-only history (we texted them first) is not "first"', greetingMoment({ lastInboundAt: null, lastOutboundAt: ago(2 * 60 * MIN) }, now) === 'returning')

console.log('firstNameOf')
check('"Joelle Park" → Joelle', firstNameOf('Joelle Park') === 'Joelle')
check('first non-empty candidate wins', firstNameOf(null, '  ', 'Ray Kim') === 'Ray')
check('apostrophes and hyphens survive', firstNameOf("D'Angelo Smith-Jones") === "D'Angelo" && firstNameOf('Mary-Kate O') === 'Mary-Kate')
check('trailing comma stripped ("Bailey, Wes" → Bailey — surname-first is still a word)', firstNameOf('Bailey, Wes') === 'Bailey')
check('digits or empty → null', firstNameOf('12345') === null && firstNameOf('') === null && firstNameOf(undefined) === null)

console.log('greetingInstruction')
check('no name → nothing added', greetingInstruction('first', null) === '')
const first = greetingInstruction('first', 'Joelle')
check('first → open with "Hi Joelle!"', /Open with "Hi Joelle!"/.test(first), first)
const ret = greetingInstruction('returning', 'Joelle')
check('returning → greet by name once, welcome back', /hour or more/.test(ret) && /Joelle/.test(ret) && /welcome back/.test(ret), ret)
const none = greetingInstruction('none', 'Joelle')
check('none → name available, do not greet again', /do not greet again/.test(none) && /Joelle/.test(none), none)
check('every variant carries the don\'t-overuse rule', [first, ret, none].every((s) => /never in every message/.test(s) && /Never use a surname/.test(s)))

if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
console.log('\nall passing')
