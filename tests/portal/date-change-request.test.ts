/**
 * The client's date-change ask — the pure rules.
 *
 * Wes 2026-09-18, on the L'anza job: "client said they wanted to change the
 * pickup date but couldn't figure out how to do that." What is pinned here
 * is the shape of the ask, not whether the change is possible — availability
 * and pricing are the cascade a rep reads in "Change dates…", and no client
 * form may answer them.
 *
 *   npm run test:date-change-request
 */
import {
  checkAsk,
  movedOnly,
  describeAsk,
  parseDay,
  toDay,
  pretty,
  windowDrifted,
  alreadySatisfied,
  NOTE_MAX,
} from '../../src/lib/portal/dateChangeRules'

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}`, detail ?? '')
  }
}

const TODAY = '2026-09-18'
const CURRENT = { start: '2026-09-20', end: '2026-09-25' }
const ask = (o: Partial<{ start: string | null; end: string | null; note: string }> = {}) => ({
  start: o.start ?? null,
  end: o.end ?? null,
  note: o.note ?? '',
})

console.log('\n— days are read in UTC, never local —')
// A @db.Date column serializes at midnight UTC. Reading it in Los Angeles
// shows the PREVIOUS day, which is the bug the portal page carries a
// comment about — a client was shown Sat Aug 8 for an order starting Sun
// Aug 9. Both directions must round-trip.
check('parseDay is UTC midnight', parseDay('2026-09-20')?.toISOString() === '2026-09-20T00:00:00.000Z')
check('toDay reads the stored day back', toDay(new Date('2026-09-20T00:00:00.000Z')) === '2026-09-20')
check('round-trips', toDay(parseDay('2026-09-20')) === '2026-09-20')
check('rejects junk', parseDay('20/09/2026') === null && parseDay('') === null && parseDay(null) === null)
check('rejects a timestamp', parseDay('2026-09-20T12:00:00Z') === null)

console.log('\n— what is a valid ask —')
check('moving the pickup', checkAsk(ask({ start: '2026-09-19' }), CURRENT, TODAY) === null)
check('moving the return', checkAsk(ask({ end: '2026-09-27' }), CURRENT, TODAY) === null)
check('moving both', checkAsk(ask({ start: '2026-09-19', end: '2026-09-27' }), CURRENT, TODAY) === null)
// A client who cannot yet name a date still has something worth telling a
// rep — "we may need to push, waiting on the location".
check('words alone are an ask', checkAsk(ask({ note: 'location may move to Thursday' }), CURRENT, TODAY) === null)
check('today is not the past', checkAsk(ask({ start: TODAY }), CURRENT, TODAY) === null)
check('same-day rental is legal', checkAsk(ask({ start: '2026-09-21', end: '2026-09-21' }), CURRENT, TODAY) === null)

console.log('\n— what is refused —')
check('an empty form', checkAsk(ask(), CURRENT, TODAY)?.code === 'empty')
check('the dates we already have', checkAsk(ask({ start: CURRENT.start, end: CURRENT.end }), CURRENT, TODAY)?.code === 'unchanged')
check('return before pickup', checkAsk(ask({ end: '2026-09-19' }), CURRENT, TODAY)?.code === 'backwards')
check('return before a moved pickup', checkAsk(ask({ start: '2026-09-24', end: '2026-09-22' }), CURRENT, TODAY)?.code === 'backwards')
check('a date already past', checkAsk(ask({ start: '2026-09-17' }), CURRENT, TODAY)?.code === 'past')
check('a note that is a novel', checkAsk(ask({ note: 'x'.repeat(NOTE_MAX + 1) }), CURRENT, TODAY)?.code === 'note-too-long')
// The refusals are read by a client, not a developer.
check('every refusal says something a client can act on', [
  checkAsk(ask(), CURRENT, TODAY),
  checkAsk(ask({ start: CURRENT.start, end: CURRENT.end }), CURRENT, TODAY),
  checkAsk(ask({ end: '2026-09-19' }), CURRENT, TODAY),
  checkAsk(ask({ start: '2026-09-17' }), CURRENT, TODAY),
].every((p) => !!p && p.message.length > 20 && /[a-z]/.test(p.message)))

console.log('\n— unchanged dates are not a request —')
// Both boxes post on every submit whatever the client touched. Without
// this, a client moving only the pickup would file a request that also
// "asks" for the return it never touched, and a rep applying it would
// re-stamp a date nobody moved.
check('only the pickup moved', JSON.stringify(movedOnly(ask({ start: '2026-09-19', end: CURRENT.end }), CURRENT)) === JSON.stringify({ start: '2026-09-19', end: null }))
check('only the return moved', JSON.stringify(movedOnly(ask({ start: CURRENT.start, end: '2026-09-27' }), CURRENT)) === JSON.stringify({ start: null, end: '2026-09-27' }))
check('both moved', JSON.stringify(movedOnly(ask({ start: '2026-09-19', end: '2026-09-27' }), CURRENT)) === JSON.stringify({ start: '2026-09-19', end: '2026-09-27' }))
check('neither moved', JSON.stringify(movedOnly(ask({ start: CURRENT.start, end: CURRENT.end }), CURRENT)) === JSON.stringify({ start: null, end: null }))
check('a cleared box is not a move', JSON.stringify(movedOnly(ask({ start: null, end: null, note: 'call me' }), CURRENT)) === JSON.stringify({ start: null, end: null }))

console.log('\n— how it reads to the desk —')
check('pickup only', describeAsk({ currentStart: '2026-09-20', currentEnd: '2026-09-25', requestedStart: '2026-09-19', requestedEnd: null }) === 'pickup Sep 20 → Sep 19')
check('both', describeAsk({ currentStart: '2026-09-20', currentEnd: '2026-09-25', requestedStart: '2026-09-19', requestedEnd: '2026-09-27' }) === 'pickup Sep 20 → Sep 19, return Sep 25 → Sep 27')
check('no date named', describeAsk({ currentStart: '2026-09-20', currentEnd: '2026-09-25', requestedStart: null, requestedEnd: null }) === 'no new date named')
check('pretty is UTC', pretty('2026-09-20') === 'Sep 20')
check('pretty names another year', pretty('2027-01-04', 2026) === 'Jan 4, 2027' && pretty('2026-09-20', 2026) === 'Sep 20')
check('pretty survives a null', pretty(null) === '—')

console.log('\n— the order moved underneath the request —')
// A rep reading a three-day-old ask must be told the window is no longer
// the one the client was looking at; applying "their" pickup blind would
// silently undo whatever changed in between.
check('no drift', windowDrifted({ start: '2026-09-20', end: '2026-09-25' }, { start: '2026-09-20', end: '2026-09-25' }) === false)
check('pickup drifted', windowDrifted({ start: '2026-09-20', end: '2026-09-25' }, { start: '2026-09-21', end: '2026-09-25' }) === true)
check('return drifted', windowDrifted({ start: '2026-09-20', end: '2026-09-25' }, { start: '2026-09-20', end: '2026-09-26' }) === true)

console.log('\n— the ask never outlives its answer —')
// Whatever route moved the dates — /dates/apply, the row editor, a hand
// edit — the queue must stop asking once the order carries what they
// wanted. This is the derived half; the resolvedAt stamp is the other.
check('pickup applied', alreadySatisfied({ start: '2026-09-19', end: null }, { start: '2026-09-19', end: '2026-09-25' }) === true)
check('pickup not applied yet', alreadySatisfied({ start: '2026-09-19', end: null }, { start: '2026-09-20', end: '2026-09-25' }) === false)
check('both applied', alreadySatisfied({ start: '2026-09-19', end: '2026-09-27' }, { start: '2026-09-19', end: '2026-09-27' }) === true)
check('only half applied is not done', alreadySatisfied({ start: '2026-09-19', end: '2026-09-27' }, { start: '2026-09-19', end: '2026-09-25' }) === false)
// A words-only ask names no date, so nothing can satisfy it but a person.
check('a words-only ask is never auto-satisfied', alreadySatisfied({ start: null, end: null }, { start: '2026-09-19', end: '2026-09-25' }) === false)

console.log('\n— an order with no dates on file —')
const EMPTY = { start: null, end: null }
check('asking for a pickup on a dateless order', checkAsk(ask({ start: '2026-09-22' }), EMPTY, TODAY) === null)
check('nothing asked is still empty', checkAsk(ask(), EMPTY, TODAY)?.code === 'empty')
check('movedOnly against nulls', JSON.stringify(movedOnly(ask({ start: '2026-09-22' }), EMPTY)) === JSON.stringify({ start: '2026-09-22', end: null }))

console.log(failures === 0 ? '\nall good\n' : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
