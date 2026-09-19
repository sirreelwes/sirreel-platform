/**
 * The rules the triage agent does not get a vote on.
 *
 *   npx tsx tests/bugs/triage-invariants.test.ts
 *   npm run test:bug-triage
 *
 * Pure + offline: no DB, no AI, no env. It exercises applyInvariants and
 * the shared vocabulary, not the model.
 *
 * Why these are pinned. The bug box promises two things to the person who
 * types into it: that a blocking problem reaches Wes, and that being given
 * an answer does not quietly mean nothing gets fixed. Both promises are
 * kept by code that OVERRIDES the model, because a model that is usually
 * right is still wrong often enough to drop a blocker — and the failure is
 * silent, which is exactly the kind of thing the box exists to catch.
 *
 * The vocabulary check is the other half: every chip label and colour is
 * keyed by enum value, so a new severity or status added to the schema
 * without a label renders `undefined` as a class name — which in Tailwind
 * is an invisible chip, not an error.
 */

import { applyInvariants, type TriageVerdict } from '../../src/lib/bugs/triage'
import { normalizeArea, rollupByArea } from '../../src/lib/bugs/rollup'
import {
  KIND_BLURB,
  KIND_LABEL,
  ROUTING_CHIP,
  ROUTING_LABEL,
  SEVERITY_CHIP,
  SEVERITY_LABEL,
  SEVERITY_RANK,
  STATUS_CHIP,
  STATUS_LABEL,
  acknowledgement,
} from '../../src/lib/bugs/vocab'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

function verdict(over: Partial<TriageVerdict>): TriageVerdict {
  return {
    title: 'Send button does nothing',
    area: 'Orders',
    severity: 'MEDIUM',
    kind: 'MECHANICAL',
    routing: 'QUEUED',
    reasoning: '',
    response: '',
    suspects: [],
    duplicateOf: null,
    missingContext: null,
    model: 'test',
    ...over,
  }
}

console.log('Bug triage invariants\n')

// ── A blocker always reaches Wes ─────────────────────────────────────────
check(
  'a BLOCKER the model wanted to merely queue is escalated anyway',
  applyInvariants(verdict({ severity: 'BLOCKER', routing: 'QUEUED' })).routing === 'ESCALATED',
)
check(
  'a BLOCKER the model wanted to answer away is escalated anyway',
  applyInvariants(verdict({ severity: 'BLOCKER', kind: 'HOW_TO', routing: 'ANSWERED' })).routing === 'ESCALATED',
)
check(
  'an escalated blocker keeps its severity',
  applyInvariants(verdict({ severity: 'BLOCKER', routing: 'QUEUED' })).severity === 'BLOCKER',
)

// ── "Answered" never closes a real fix ───────────────────────────────────
check(
  'a misleading screen (DESIGN) stays on the board even when the reporter got an answer',
  applyInvariants(verdict({ kind: 'DESIGN', severity: 'LOW', routing: 'ANSWERED' })).routing === 'QUEUED',
)
check(
  'broken mechanics are never answered away',
  applyInvariants(verdict({ kind: 'MECHANICAL', routing: 'ANSWERED' })).routing === 'QUEUED',
)
check(
  'a feature request is not answered away either — it is a to-do',
  applyInvariants(verdict({ kind: 'FEATURE_REQUEST', routing: 'ANSWERED' })).routing === 'QUEUED',
)
check(
  'a genuine how-to question IS answered and closed',
  applyInvariants(verdict({ kind: 'HOW_TO', severity: 'LOW', routing: 'ANSWERED' })).routing === 'ANSWERED',
)
check(
  'something not about the software is answered and closed',
  applyInvariants(verdict({ kind: 'OTHER', severity: 'LOW', routing: 'ANSWERED' })).routing === 'ANSWERED',
)
check(
  'the answer text survives being re-routed to the board',
  applyInvariants(verdict({ kind: 'DESIGN', routing: 'ANSWERED', response: 'the button is disabled until a rate exists' }))
    .response === 'the button is disabled until a rate exists',
)

// ── A wish is not an emergency ───────────────────────────────────────────
check(
  'a feature request cannot claim BLOCKER and jump the queue',
  applyInvariants(verdict({ kind: 'FEATURE_REQUEST', severity: 'BLOCKER' })).severity === 'HIGH',
)
check(
  'a MECHANICAL blocker is untouched by that rule',
  applyInvariants(verdict({ kind: 'MECHANICAL', severity: 'BLOCKER' })).severity === 'BLOCKER',
)

// ── Ordinary verdicts pass straight through ──────────────────────────────
const plain = verdict({ kind: 'MECHANICAL', severity: 'HIGH', routing: 'QUEUED' })
check(
  'a plain queued mechanical bug is not rewritten',
  JSON.stringify(applyInvariants(plain)) === JSON.stringify(plain),
)

// ── What the agent could not work out (board-only, never a question) ─────
check(
  'nothing is "missing" on a report that needed no fix',
  applyInvariants(verdict({ kind: 'HOW_TO', routing: 'ANSWERED', missingContext: 'no job in the trail' }))
    .missingContext === null,
)
check(
  'nothing is "missing" on a duplicate — it is worked on its parent',
  applyInvariants(verdict({ duplicateOf: 'abc', missingContext: 'no job in the trail' })).missingContext === null,
)
check(
  'a queued report keeps its note about what could not be determined',
  applyInvariants(verdict({ kind: 'MECHANICAL', routing: 'QUEUED', missingContext: 'No order page in the trail.' }))
    .missingContext === 'No order page in the trail.',
)
check(
  'an escalated blocker keeps it too',
  applyInvariants(verdict({ severity: 'BLOCKER', missingContext: 'Invoice id not in the trail.' })).missingContext ===
    'Invoice id not in the trail.',
)

// ── Every enum value can be rendered ─────────────────────────────────────
const SEVERITIES = ['UNTRIAGED', 'BLOCKER', 'HIGH', 'MEDIUM', 'LOW'] as const
const KINDS = ['UNTRIAGED', 'MECHANICAL', 'DESIGN', 'HOW_TO', 'FEATURE_REQUEST', 'OTHER'] as const
const ROUTINGS = ['PENDING', 'ANSWERED', 'QUEUED', 'ESCALATED'] as const
const STATUSES = ['OPEN', 'IN_PROGRESS', 'FIXED', 'WONT_FIX', 'DUPLICATE', 'ANSWERED'] as const

check(
  'every severity has a label, a chip and a sort rank',
  SEVERITIES.every((s) => !!SEVERITY_LABEL[s] && !!SEVERITY_CHIP[s] && typeof SEVERITY_RANK[s] === 'number'),
)
check('every kind has a label and a blurb', KINDS.every((k) => !!KIND_LABEL[k] && !!KIND_BLURB[k]))
check('every routing has a label and a chip', ROUTINGS.every((r) => !!ROUTING_LABEL[r] && !!ROUTING_CHIP[r]))
check('every status has a label and a chip', STATUSES.every((s) => !!STATUS_LABEL[s] && !!STATUS_CHIP[s]))
check(
  'blockers sort above everything else',
  SEVERITIES.filter((s) => s !== 'BLOCKER').every((s) => SEVERITY_RANK.BLOCKER < SEVERITY_RANK[s]),
)
check(
  'an untriaged report sorts above the ordinary ones, not below them',
  SEVERITY_RANK.UNTRIAGED < SEVERITY_RANK.HIGH &&
    SEVERITY_RANK.UNTRIAGED < SEVERITY_RANK.MEDIUM &&
    SEVERITY_RANK.UNTRIAGED < SEVERITY_RANK.LOW,
)

// ── What the reporter is told ────────────────────────────────────────────
check(
  'every routing has something friendly to say back',
  ROUTINGS.every((r) => acknowledgement(r, 'MEDIUM').length > 20),
)
check(
  'a blocking escalation says so, rather than sounding like a queue',
  acknowledgement('ESCALATED', 'BLOCKER') !== acknowledgement('ESCALATED', 'HIGH'),
)

// ── The aggregate view ──────────────────────────────────────────────────
const ROWS = [
  { id: 'a', area: 'Jobs / Orders', severity: 'HIGH' as const, kind: 'MECHANICAL' as const, duplicateCount: 2 },
  { id: 'b', area: 'jobs/orders', severity: 'BLOCKER' as const, kind: 'MECHANICAL' as const, duplicateCount: 0 },
  { id: 'c', area: 'Yard', severity: 'LOW' as const, kind: 'DESIGN' as const, duplicateCount: 0 },
  { id: 'd', area: null, severity: 'MEDIUM' as const, kind: 'UNTRIAGED' as const, duplicateCount: 0 },
]
const groups = rollupByArea(ROWS)

check(
  'areas written differently by the agent collapse into one group',
  normalizeArea('jobs/orders') === normalizeArea('Jobs / Orders'),
)
check('an area-less report groups under Unsorted', normalizeArea(null) === 'Unsorted')
check('the two Jobs/Orders rows are one group of 2', groups[0].area === 'Jobs / Orders' && groups[0].count === 2)
check('a group takes the WORST severity in it', groups[0].worst === 'BLOCKER')
check('a group with a blocker says so', groups[0].blocking === true)
check(
  'people counts the duplicates too — three reports behind two issues',
  groups[0].people === 4,
)
check('the worst group sorts first', groups[0].worst === 'BLOCKER')
check(
  'every open id appears in exactly one group',
  groups.flatMap((g) => g.ids).sort().join(',') === 'a,b,c,d',
)
check(
  'handing a group over hands over exactly its own ids',
  groups[0].ids.sort().join(',') === 'a,b',
)

// ── Nothing the agent decides removes a report from view ────────────────
// Wes 2026-09-19: "I'd rather have reports come through than not... I don't
// want AI just to shut down for no reason." These pin the shape of that.
check(
  'answering is still restricted to genuine how-tos',
  applyInvariants(verdict({ kind: 'DESIGN', routing: 'ANSWERED' })).routing === 'QUEUED' &&
    applyInvariants(verdict({ kind: 'MECHANICAL', routing: 'ANSWERED' })).routing === 'QUEUED',
)
check(
  'an answered how-to keeps the answer text for the reporter',
  applyInvariants(verdict({ kind: 'HOW_TO', routing: 'ANSWERED', response: 'it lives under Units' }))
    .response === 'it lives under Units',
)
check(
  'a duplicate still carries its severity to the parent rather than being downgraded',
  applyInvariants(verdict({ duplicateOf: 'abc', severity: 'BLOCKER' })).severity === 'BLOCKER',
)
check(
  'a blocker that the model tried to fold away still escalates',
  applyInvariants(verdict({ duplicateOf: 'abc', severity: 'BLOCKER', routing: 'QUEUED' })).routing === 'ESCALATED',
)

console.log()
if (failures.length) {
  console.error(`FAILED (${failures.length}):`)
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('All bug-triage invariants hold.')
