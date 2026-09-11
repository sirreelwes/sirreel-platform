/**
 * Billing-week decision tests — when the quote builder has to ask.
 *
 *   npx tsx tests/orders/week-decision.test.ts
 *   npm run test:week-decision
 *
 * Pure + offline: arithmetic over builder rows, no DB.
 *
 * The defect these guard (Wes 2026-09-11): "If a 3d 2d or 1d week isn't
 * selected, it goes out full rate." A dated line takes the DEPARTMENT'S
 * STANDARD week, and a week cap can only remove days — so on a rental no
 * longer than that week it removes none, the quote goes out at the
 * highest number the system can produce, and the only sign was a select
 * reading "Week…".
 *
 * The two directions that matter:
 *
 *   · SILENCE on a section quoting full rate — the lost job. Every case
 *     below that expects `pending` is a quote that would have gone out
 *     high with nobody asked.
 *   · NAGGING when there is nothing to decide — the prompt people learn
 *     to click through, which costs the first direction its only
 *     defence. A one-day rental, an undated section, a section someone
 *     already answered, and hand-typed day counts must all stay quiet.
 */

import type { LineItemDepartment } from '@prisma/client'
import {
  capInEffect,
  weekCapExempt,
  weekDecisionsPending,
  weekSection,
  type WeekLine,
} from '../../src/lib/orders/weekDecision'

const failures: string[] = []
function check(got: unknown, want: unknown, why: string): void {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) console.log(`  ok — ${why}`)
  else {
    console.log(`  FAIL — ${why}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
    failures.push(why)
  }
}

function line(over: Partial<WeekLine> = {}): WeekLine {
  return {
    department: 'COMMUNICATIONS',
    quantity: 1,
    rate: 10,
    rateType: 'DAILY',
    billableDays: 3,
    pickupDate: '2026-09-13',
    returnDate: '2026-09-19',
    catalogProductId: 'inv-1',
    description: 'Surveillance Kit',
    ...over,
  }
}

const deltasOf = (dept: LineItemDepartment, lines: WeekLine[]) =>
  weekSection(dept, lines)?.options.map((o) => [o.cap, o.delta])

// ── The live quote from the screenshot ─────────────────────────────────
// 6 calendar days of Communications gear, standard 3-day week: 6 kits ×
// $7 × 3 days = $126, and 3 chairs × $4 × 3 = $36. The 3-day week DID
// discount here — and the question is still unanswered, because a 2-day
// week is $84/$24 and nobody was ever shown that.
console.log('\nthe screenshot — 6-day Communications section at the standard week')
const screenshot: WeekLine[] = [
  line({ quantity: 6, rate: 7, billableDays: 3 }),
  line({ quantity: 3, rate: 4, billableDays: 3, description: "Director's Chairs, Low" }),
]
check(capInEffect('COMMUNICATIONS', screenshot), 3, 'rows read as the standard 3-day week')
check(weekSection('COMMUNICATIONS', screenshot)?.currentTotal, 162, 'section prices at $162')
check(weekSection('COMMUNICATIONS', screenshot)?.currentDays, 6, 'two lines × 3 billable days')
check(weekSection('COMMUNICATIONS', screenshot)?.calendarDays, 6, '6 days on the calendar')
check(
  deltasOf('COMMUNICATIONS', screenshot),
  [[3, 0], [2, -54], [1, -108]],
  'a 2-day week is $54 cheaper, a 1-day week $108',
)
check(
  weekDecisionsPending(screenshot, {}).map((s) => s.department),
  ['COMMUNICATIONS'],
  'asked about — the standard week discounting SOMETHING is not an answer',
)

// ── Full rate, silently: the rental no longer than its own week ────────
// Three calendar days at a 3-day week bills three days. The cap did
// nothing, the section is at list, and before the prompt nothing said so.
console.log('\nthe defect — a rental no longer than the department week')
const shortJob = [line({ quantity: 6, rate: 7, billableDays: 3, returnDate: '2026-09-16' })]
check(capInEffect('COMMUNICATIONS', shortJob), 3, 'still reads as the 3-day week')
check(weekSection('COMMUNICATIONS', shortJob)?.currentTotal, 126, 'every calendar day billed')
check(
  deltasOf('COMMUNICATIONS', shortJob),
  [[3, 0], [2, -42], [1, -84]],
  'two thirds of the section is available to negotiate',
)
check(weekDecisionsPending(shortJob, {}).length, 1, 'asked about')

// GE's week IS seven days, so every GE rental inside a week is full rate.
console.log('\nGE — the department whose standard week discounts nothing')
const ge = [line({ department: 'GE', quantity: 2, rate: 50, billableDays: 4, returnDate: '2026-09-17' })]
check(capInEffect('GE', ge), 7, 'the 7-day week explains 4 days of a 4-day rental')
check(
  deltasOf('GE', ge),
  [[7, 0], [6, 0], [5, 0], [4, 0], [3, -100], [2, -200], [1, -300]],
  'nothing shorter than the rental changes it; a 3-day week takes $100',
)
check(weekDecisionsPending(ge, {}).length, 1, 'asked about')

// ── Quiet when there is nothing to decide ──────────────────────────────
console.log('\nquiet — the cases a prompt must not interrupt')
const oneDay = [line({ billableDays: 1, returnDate: '2026-09-14' })]
check(capInEffect('COMMUNICATIONS', oneDay), 3, 'a one-day rental bills one day at every week')
check(weekDecisionsPending(oneDay, {}).length, 0, 'no shorter week changes the money — silent')

check(
  weekDecisionsPending(screenshot, { COMMUNICATIONS: 2 }).length,
  0,
  'already answered this session — silent',
)

const handTyped = [line({ billableDays: 4 })]
check(capInEffect('COMMUNICATIONS', handTyped), 'custom', 'no week produces 4 days from 6')
check(weekDecisionsPending(handTyped, {}).length, 0, 'hand-typed days are a decision — silent')

const undated = [line({ billableDays: null, pickupDate: '', returnDate: '' })]
check(capInEffect('COMMUNICATIONS', undated), null, 'nothing dated, nothing priced by a week')
check(weekSection('COMMUNICATIONS', undated), null, 'no section to ask about')
check(weekDecisionsPending(undated, {}).length, 0, 'dates TBD — silent, never guessed at')

const expendable = [line({ department: 'EXPENDABLES', rateType: 'FLAT', billableDays: 1 })]
check(capInEffect('EXPENDABLES', expendable), null, 'purchases have no week')
check(weekDecisionsPending(expendable, {}).length, 0, 'gaff tape is sold, not rented — silent')

// ── Specialty vehicles: never offered a week ───────────────────────────
// They bill calendar days with no weekly reduction (Wes 2026-09-07, the
// class 2026-09-10). The order page shows them no cap chips and the
// bulk-days / dates-apply routes refuse to write one — a prompt that
// quoted the discount anyway would be quoting a price the write refuses.
console.log('\nspecialty vehicles — outside the week entirely')
const motorhome = line({
  department: 'VEHICLES',
  description: '32ft Motorhome',
  catalogProductId: null,
  quantity: 1,
  rate: 900,
  billableDays: 5,
})
check(weekCapExempt(motorhome), true, 'typed motorhome, no catalog row — exempt by name')
check(
  weekCapExempt({ ...motorhome, catalogProductId: 'inv-dlux' }),
  false,
  'a catalogued unit answers through its own flag, which the builder cannot see',
)
check(weekSection('VEHICLES', [motorhome]), null, 'a section of only specialty units: nothing to ask')
check(weekDecisionsPending([motorhome], {}).length, 0, 'silent — no discount to offer')

const mixedVehicles = [
  motorhome,
  line({ department: 'VEHICLES', description: 'Cargo Van', quantity: 2, rate: 100, billableDays: 5 }),
]
check(
  weekSection('VEHICLES', mixedVehicles)?.currentTotal,
  1000,
  'the van is priced, the motorhome is not counted in the offer',
)
check(weekSection('VEHICLES', mixedVehicles)?.skippedCount, 1, 'and the agent is told one line was left out')
check(
  deltasOf('VEHICLES', mixedVehicles),
  [[5, 0], [4, -200], [3, -400], [2, -600], [1, -800]],
  'the 5-day vehicles week, and what is under it',
)

// ── Ordering: the most exposed section is asked about first ────────────
console.log('\nordering')
const twoSections = [
  line({ quantity: 6, rate: 7, billableDays: 3 }),
  line({ department: 'GE', quantity: 4, rate: 80, billableDays: 3, description: 'Distro' }),
]
check(
  weekDecisionsPending(twoSections, {}).map((s) => s.department),
  ['GE', 'COMMUNICATIONS'],
  'the section with the most money on the table comes first',
)

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  · ${f}`)
  process.exit(1)
}
console.log('week-decision: all checks passed')
