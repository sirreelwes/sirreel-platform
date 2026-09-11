/**
 * The partner's rate form — refused, not guessed at.
 *
 *   · parseProposedRate: numbers and numeric strings only; blank is "not
 *     proposing"; zero, negatives, booleans and anything past the cap refuse.
 *   · parseRateProposal: one bad field refuses the whole proposal; an empty
 *     form still asks for at least one rate.
 *
 * Run: npm run test:rate-proposal
 */
import { parseProposedRate, parseRateProposal, MAX_PROPOSED_RATE } from '@/lib/sub-rentals/rateProposalInput'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

eq('a number', parseProposedRate(450), { ok: true, value: 450 })
eq('a numeric string', parseProposedRate('450'), { ok: true, value: 450 })
eq('dollars and commas, as typed', parseProposedRate('$1,200.50'), { ok: true, value: 1200.5 })
eq('rounded to cents', parseProposedRate(99.999), { ok: true, value: 100 })
eq('blank string is not proposing', parseProposedRate('  '), { ok: true, value: null })
eq('null is not proposing', parseProposedRate(null), { ok: true, value: null })
eq('true is refused, not $1', parseProposedRate(true), { ok: false })
eq('words are refused', parseProposedRate('abc'), { ok: false })
eq('zero is refused', parseProposedRate(0), { ok: false })
eq('negative is refused', parseProposedRate(-5), { ok: false })
eq('Infinity is refused', parseProposedRate(Infinity), { ok: false })
eq('the cap itself is allowed', parseProposedRate(MAX_PROPOSED_RATE), { ok: true, value: MAX_PROPOSED_RATE })
eq('past the cap is refused (Decimal(10,2) would throw)', parseProposedRate(1e9), { ok: false })
eq('exponent strings are refused', parseProposedRate('1e9'), { ok: false })
eq('an object is refused', parseProposedRate({ valueOf: () => 5 }), { ok: false })

const good = parseRateProposal({ daily: '450', weekly: '', monthly: null, note: '  new season  ' })
eq('valid body parses', good, { ok: true, input: { daily: 450, weekly: null, monthly: null, note: 'new season' } })
eq('one bad field refuses the lot', parseRateProposal({ daily: 450, weekly: true }).ok, false)
eq('empty form asks for a rate', parseRateProposal({}), { ok: false, error: 'Enter at least one rate.' })

console.log(fail === 0 ? '\nall good' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
