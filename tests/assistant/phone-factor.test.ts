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

// ── The release bar, as a table ─────────────────────────────────────────
// Mirrors the `authed` expression in src/lib/assistant/afterHours.ts. That
// module talks to the DB, so the decision itself is re-stated here and the
// two must be changed together — this is the table Wes's rules live in.
type Factors = { jobCodeOk: boolean; vinLast4Ok: boolean; nameOk: boolean; phoneOk: boolean; unitOk: boolean }
const f = (o: Partial<Factors> = {}): Factors => ({ jobCodeOk: false, vinLast4Ok: false, nameOk: false, phoneOk: false, unitOk: false, ...o })
function releases(x: Factors): boolean {
  return (
    (x.jobCodeOk && (x.vinLast4Ok || x.nameOk)) ||
    (!x.jobCodeOk && x.unitOk && x.nameOk) ||
    (x.phoneOk && (x.vinLast4Ok || x.unitOk || x.nameOk))
  )
}

console.log('release bar — the sender number')
check('number + their name, nothing else (parked, gone home)', releases(f({ phoneOk: true, nameOk: true })))
check('number + unit number', releases(f({ phoneOk: true, unitOk: true })))
check('number + VIN last 4', releases(f({ phoneOk: true, vinLast4Ok: true })))
check('number ALONE does not release', !releases(f({ phoneOk: true })))

console.log('release bar — unchanged paths')
check('job code + VIN', releases(f({ jobCodeOk: true, vinLast4Ok: true })))
check('job code + name', releases(f({ jobCodeOk: true, nameOk: true })))
check('job code alone does not release', !releases(f({ jobCodeOk: true })))
check('legacy unit + name', releases(f({ unitOk: true, nameOk: true })))
check('unit alone does not release', !releases(f({ unitOk: true })))
check('a name alone, from an unknown number, never releases', !releases(f({ nameOk: true })))
check('nothing releases nothing', !releases(f()))

// ── First name or last name is enough (Wes 2026-09-15) ──────────────────
// nameMatches: every token of the shorter name must appear in the longer.
function normTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
}
function nameMatches(provided: string, candidate: string): boolean {
  const p = normTokens(provided)
  const c = normTokens(candidate)
  if (p.length === 0 || c.length === 0) return false
  const [shorter, longer] = p.length <= c.length ? [p, c] : [c, p]
  return shorter.every((t) => longer.includes(t))
}

console.log('name matching')
check('first name alone matches the full name on file', nameMatches('Mike', 'Mike Rodriguez'))
check('last name alone matches', nameMatches('Rodriguez', 'Mike Rodriguez'))
check('full name matches', nameMatches('Mike Rodriguez', 'Mike Rodriguez'))
check('case and punctuation are ignored', nameMatches('o\'brien', "O'Brien"))
check('a different name does not match', !nameMatches('Dave', 'Mike Rodriguez'))
check('an empty name never matches', !nameMatches('', 'Mike Rodriguez'))

if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
console.log('\nall passing')
