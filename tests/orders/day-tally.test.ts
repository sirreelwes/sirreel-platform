/**
 * Orders-by-day tally tests.
 *
 *   npx tsx tests/orders/day-tally.test.ts
 *   npm run test:order-day-tally
 *
 * Pure + offline. This is the function the EOD collections report renders into
 * the evening email AND the one the /orders date filter shows above the table
 * (Ana, 2026-09-17: "know if the EOD report that gets generated is accurate or
 * not"). The whole value of the check is that ONE definition answers both, so
 * what is guarded here is the definition itself:
 *
 *   - the quote/order split reads quoteStatus, never status
 *   - a booked order is worth bookedTotal, a quote is worth total
 *   - cancelled is out; draft, lost and archived are IN
 *   - the reconciliation line names every way the table will differ, and says
 *     nothing at all on a day where it won't
 *
 * Plus the Pacific day window, because a UTC cut would move every order
 * written after 4pm into the next day's report.
 */
import {
  tallyOrderDay,
  reconciliationNote,
  isQuoteRow,
  type DayTallyRow,
} from '../../src/lib/orders/dayTally'
import { pacificDayRange, pacificRange, isYmd } from '../../src/lib/time/pacificDay'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}\n      got  ${g}\n      want ${w}`); failures.push(why) }
}

const row = (o: Partial<DayTallyRow>): DayTallyRow => ({
  quoteStatus: 'SENT', status: 'QUOTE_SENT', total: 0, bookedTotal: null, archivedAt: null, ...o,
})

console.log('\nthe quote / order split')
eq(isQuoteRow({ quoteStatus: 'DRAFT' }), true, 'a draft is a quote')
eq(isQuoteRow({ quoteStatus: 'SENT' }), true, 'a sent quote is a quote')
eq(isQuoteRow({ quoteStatus: 'WON' }), false, 'won is on the books')
eq(isQuoteRow({ quoteStatus: 'LOST' }), false, 'lost is not a live proposal either')

// The split must not read `status`: an order can be BOOKED while quoteStatus
// still says SENT, and the question the report asks is whether the client said
// yes — which lives on quoteStatus.
eq(
  tallyOrderDay([row({ quoteStatus: 'SENT', status: 'BOOKED', total: 100 })]).quotes.count,
  1,
  'BOOKED with quoteStatus SENT still counts as a quote',
)

console.log('\nwhat each side is worth')
eq(
  tallyOrderDay([row({ quoteStatus: 'WON', status: 'BOOKED', total: 900, bookedTotal: 1000 })]).orders,
  { count: 1, amount: 1000 },
  'a booked order is worth bookedTotal, not the drifting total',
)
eq(
  tallyOrderDay([row({ quoteStatus: 'WON', status: 'APPROVED', total: 750, bookedTotal: null })]).orders,
  { count: 1, amount: 750 },
  'an order with no bookedTotal yet falls back to total',
)
eq(
  tallyOrderDay([row({ quoteStatus: 'SENT', total: 500, bookedTotal: 9999 })]).quotes,
  { count: 1, amount: 500 },
  'a quote is worth total even if a bookedTotal is somehow set',
)

// Decimal-shaped input: Prisma hands these back as objects, and the tally has
// to round at cents or a day of $33.33 rows drifts.
eq(
  tallyOrderDay([
    row({ quoteStatus: 'SENT', total: '33.335' }),
    row({ quoteStatus: 'SENT', total: '33.335' }),
    row({ quoteStatus: 'SENT', total: '33.33' }),
  ]).quotes.amount,
  100.01,
  'each row rounds to cents before it is added',
)
eq(tallyOrderDay([row({ total: null })]).quotes.amount, 0, 'a null total is zero, not NaN')

console.log('\nwho is in and who is out')
const mixed = [
  row({ quoteStatus: 'WON', status: 'BOOKED', total: 100, bookedTotal: 100 }),
  row({ quoteStatus: 'SENT', status: 'QUOTE_SENT', total: 200 }),
  row({ quoteStatus: 'DRAFT', status: 'DRAFT', total: 300 }),
  row({ quoteStatus: 'LOST', status: 'QUOTE_SENT', total: 400 }),
  row({ quoteStatus: 'WON', status: 'BOOKED', total: 500, bookedTotal: 500, archivedAt: new Date() }),
  row({ quoteStatus: 'SENT', status: 'CANCELLED', total: 999 }),
]
const t = tallyOrderDay(mixed)
eq(t.orders, { count: 3, amount: 1000 }, 'won + lost + archived are all on the books side')
eq(t.quotes, { count: 2, amount: 500 }, 'the draft counts; the cancelled row does not')
eq(t.total, 1500, 'the together figure is the two sides, cancelled excluded')
eq(t.includes, { drafts: 1, lost: 1, archived: 1 }, 'the hidden-by-default rows are counted, and named')
eq(t.excludedCancelled, 1, 'cancelled rows are reported, not silently dropped')

// The trap this whole module exists to avoid: counting only what the list
// shows. A day of one draft would read as zero.
eq(
  tallyOrderDay([row({ quoteStatus: 'DRAFT', status: 'DRAFT', total: 300 })]).quotes,
  { count: 1, amount: 300 },
  'a day whose only row is a draft is not an empty day',
)

console.log('\nthe reconciliation line')
eq(
  reconciliationNote(t),
  'Counts 1 draft, 1 lost, 1 archived the list hides by default. Leaves out 1 cancelled order the list still shows.',
  'both directions are named, with the counts',
)
eq(
  reconciliationNote(tallyOrderDay([row({ quoteStatus: 'WON', status: 'BOOKED', total: 10, bookedTotal: 10 })])),
  null,
  'a day the table matches exactly gets no note at all',
)
eq(
  reconciliationNote(tallyOrderDay([
    row({ quoteStatus: 'DRAFT', status: 'DRAFT', total: 1 }),
    row({ quoteStatus: 'DRAFT', status: 'DRAFT', total: 1 }),
  ])),
  'Counts 2 drafts the list hides by default.',
  'plurals agree, and nothing is said about cancelled rows when there are none',
)

eq(tallyOrderDay([]), {
  orders: { count: 0, amount: 0 },
  quotes: { count: 0, amount: 0 },
  total: 0,
  includes: { drafts: 0, lost: 0, archived: 0 },
  excludedCancelled: 0,
}, 'an empty day tallies to zeroes, never to null')

console.log('\nthe Pacific day, not the UTC one')
// Sep 17 2026 is PDT (-07:00), so the business day runs 07:00Z → 07:00Z.
eq(pacificDayRange('2026-09-17').start.toISOString(), '2026-09-17T07:00:00.000Z', 'PDT day starts at 07:00Z')
eq(pacificDayRange('2026-09-17').end.toISOString(), '2026-09-18T07:00:00.000Z', 'and ends a day later')
// January is PST (-08:00) — a fixed offset would be an hour wrong here.
eq(pacificDayRange('2026-01-15').start.toISOString(), '2026-01-15T08:00:00.000Z', 'PST day starts at 08:00Z')
// An order written at 5pm Pacific on the 17th is 00:00Z on the 18th — the
// whole reason this is not a UTC cut.
const evening = new Date('2026-09-18T00:00:00.000Z')
const d17 = pacificDayRange('2026-09-17')
eq(
  evening >= d17.start && evening < d17.end,
  true,
  'an order written at 5pm Pacific stays on the same business day as the report',
)

console.log('\nthe multi-day window')
eq(pacificRange('2026-09-15', '2026-09-17').start.toISOString(), '2026-09-15T07:00:00.000Z', 'a range starts on its first day')
eq(pacificRange('2026-09-15', '2026-09-17').end.toISOString(), '2026-09-18T07:00:00.000Z', 'and runs through the END of its last')
eq(
  pacificRange('2026-09-17', '2026-09-15').start.toISOString(),
  '2026-09-15T07:00:00.000Z',
  'a backwards range is read the right way round, not as an empty day',
)
eq(pacificRange('2026-09-17', '2026-09-17').end.getTime() - pacificRange('2026-09-17', '2026-09-17').start.getTime(),
  86_400_000, 'a single day is exactly 24h in PDT')

console.log('\ndate parsing')
eq(isYmd('2026-09-17'), true, 'a well-formed date passes')
eq(isYmd('2026-9-7'), false, 'an unpadded date is refused rather than guessed at')
eq(isYmd(''), false, 'an empty box is not a filter')
eq(isYmd(null), false, 'a missing param is not a filter')
eq(isYmd('today'), false, 'junk is refused')

console.log(failures.length === 0 ? '\nAll passed.\n' : `\n${failures.length} FAILED\n`)
process.exit(failures.length === 0 ? 0 : 1)
