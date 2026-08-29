/**
 * Dedup cluster classification — the decision that stands between a shared
 * office phone line and a destroyed contact.
 *
 * The stakes are asymmetric, so both directions are asserted:
 *   · FALSE POSITIVE (colleagues → LIKELY_DUPE) is the expensive one. The UI
 *     pre-selects a survivor and merging is one click, so a mislabelled
 *     reception line takes real people out of the book.
 *   · FALSE NEGATIVE (one human → UNCERTAIN) only costs a second look, but
 *     enough of them and a 200-cluster queue stops being worth working.
 *
 * Every fixture below is a REAL cluster from the 2026-08-29 queue.
 *
 * The bug this guards: `lastName` is a placeholder ("" or ".") on 2,908 of
 * 5,187 people, and the classifier deleted blanks from the surname set —
 * turning "surname unknown" into "surnames agree". Three colleagues on the
 * Dust Studios line came back LIKELY_DUPE claiming they all shared the
 * surname "Bucci", which was true of exactly one of them.
 *
 * Run: npm run test:cluster-classify
 */
import { classifyCluster, type ClusterMember } from '@/lib/people/clusters'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${got}${ok ? '' : ` (want ${want})`}`)
}

let n = 0
const m = (firstName: string, lastName: string, refCount = 0): ClusterMember => ({
  id: `p${++n}`, firstName, lastName, email: `p${n}@x.com`,
  refCount, hasUserAccount: false, source: null, createdAt: new Date('2026-01-01'),
})
const cls = (...members: ClusterMember[]) => classifyCluster({ key: 'phone:5555550100', members }).classification

// ── Colleagues on one office line. Must never be LIKELY_DUPE. ──────────
// The whole name sits in firstName and lastName is a dot — the exact shape
// that used to collapse into "all members share last name".
eq('Dust Studios reception (3 colleagues, dotted surnames)',
  cls(m('Sophia Acosta', '.'), m('Ramses Pacheco', '.'), m('Jeanette Bucci', '')),
  'LIKELY_OFFICE_MAINLINE')
eq('Mardini / Miele / Meier',
  cls(m('Natalie Mardini', '.'), m('Joseph P. Miele', '.'), m('Arthur Meier', '')),
  'LIKELY_OFFICE_MAINLINE')

// Two colleagues, not three — too few for the mainline rule, so the given
// name has to catch it.
eq('two colleagues on one line → UNCERTAIN',
  cls(m('Mike Simeone', '.'), m('Adam Navarro', '.')), 'UNCERTAIN')
eq('Jordan Elizondo / Donny McGuire → UNCERTAIN',
  cls(m('Jordan Elizondo', '.'), m('DONNY MCGUIRE', '.')), 'UNCERTAIN')
eq('no surname anywhere + different given names → UNCERTAIN',
  cls(m('Merry', '.'), m('Iunia', '.')), 'UNCERTAIN')

// ── One human across several mailboxes. Must stay LIKELY_DUPE. ─────────
eq('Abi Perl across two mailboxes', cls(m('Abi', 'Perl'), m('Abi', 'Perl')), 'LIKELY_DUPE')
eq('surname in firstName, still one person',
  cls(m('Rachel Nagao', '.'), m('Rachel Nagao', '.')), 'LIKELY_DUPE')
// Reps tag a person's rows with the employer in parens. Which FIELD the tag
// lands in is an accident of typing, so both must be stripped — leaving it
// in lastName made one Anthony Baldino read as three surnames.
eq('parenthetical employer tags in lastName',
  cls(m('Anthony', 'Baldino (LD)'), m('Anthony', 'Baldino (Gmail)'), m('Anthony', 'Baldino (Normal)')),
  'LIKELY_DUPE')
eq('parenthetical tags in firstName',
  cls(m('Julia (Echobend)', 'Walker'), m('Julia (Gmail)', 'Walker')), 'LIKELY_DUPE')
// Maiden/married or a surname typo, with the given name agreeing.
eq('2 surname variants + one given name',
  cls(m('Rob Newcome', '.'), m('Rob Newcombe', '.')), 'LIKELY_DUPE')
// Genuinely no surname on anyone, but the given name matches.
eq('mononym pair → LIKELY_DUPE', cls(m('Taylor', '.'), m('Taylor', '')), 'LIKELY_DUPE')

// ── Degenerate input ───────────────────────────────────────────────────
eq('single member is not a cluster', cls(m('Abi', 'Perl')), 'UNCERTAIN')

console.log(fail === 0 ? '\nAll cluster-classification checks passed.' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
