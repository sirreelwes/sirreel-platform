/**
 * Job email change signals — the pure classifier.
 *
 *   npm run test:job-change-signals
 *
 * Wes 2026-09-11: a client's cancelling or changing a job carries nuance,
 * so email never changes HQ on its own — it raises a suggestion. These
 * pin what raises one (and as which kind), what must not, and that the
 * evidence quotes the client's words back so the reader can judge.
 */
import { classifyChangeSignal } from '../../src/lib/email/jobChangeSignals'

let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`)
  else { failed++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

const sig = (subject: string, body: string, extra: Parameters<typeof classifyChangeSignal>[0] extends infer T ? Partial<T> : never = {}) =>
  classifyChangeSignal({ subject, bodyText: body, ...extra })

console.log('cancellation')
{
  const r = sig('Re: Quote S260904-002', 'Hi Jose — unfortunately the project got cancelled. Thanks for holding the cube for us.')
  check('"project got cancelled" → CANCEL', r?.kind === 'CANCEL', r)
  check('evidence quotes the phrase', !!r && r.evidence.some((e) => /cancelled/.test(e)), r?.evidence)
}
{
  const r = sig('Re: Pass van', "We won't be moving forward with the rental, going with the studio's van.")
  check('"won\'t be moving forward" → CANCEL', r?.kind === 'CANCEL', r)
}
{
  const r = sig('Re: Quote', 'Thanks, we will review.', { replyClassification: 'EXPLICIT_REJECTION' })
  check('classifier rejection with no phrase → CANCEL', r?.kind === 'CANCEL', r)
  check('classifier named in evidence', !!r && r.evidence.includes('reply classifier: EXPLICIT_REJECTION'), r?.evidence)
}
{
  const r = sig('Re: Quote', 'Thanks, we will review.', { messageNature: 'rejection' })
  check('extractor rejection with no phrase → CANCEL', r?.kind === 'CANCEL', r)
}

console.log('other kinds win over cancel when both appear')
{
  const r = sig('Re: Cube 27', "Can we cancel the Friday return and keep it through Monday instead?")
  check('extension is EXTEND, not CANCEL', r?.kind === 'EXTEND', r)
}
{
  const r = sig('Re: Shoot', 'Shoot got pushed — pickup is now Thursday instead of Tuesday.')
  check('"shoot got pushed" → DATE_CHANGE', r?.kind === 'DATE_CHANGE', r)
}
{
  const r = sig('Re: Shoot', 'We are wrapping early, returning the trailer a day early on Wed.')
  check('"returning … early" → RETURN_EARLY', r?.kind === 'RETURN_EARLY', r)
}
{
  const r = sig('Re: Booking', 'Client put the job on hold until they hear back on budget.')
  check('"on hold" → HOLD', r?.kind === 'HOLD', r)
}

console.log('add-ons and drops are order changes, not job cancellations')
{
  const r = sig('Re: S260910-003', 'Hi Jose — can we add a couple of fans to the order? Same dates.')
  check('"add a couple of fans to the order" → ADD_ITEMS', r?.kind === 'ADD_ITEMS', r)
}
{
  const r = sig('Re: Quote', 'Could you also throw in two walkies for the shoot days?')
  check('"throw in two walkies" → ADD_ITEMS', r?.kind === 'ADD_ITEMS', r)
}
{
  const r = sig('Re: Quote', 'Please add the generator to the rental, we lost our house power.')
  check('"add the generator to the rental" → ADD_ITEMS', r?.kind === 'ADD_ITEMS', r)
}
{
  const r = sig('Re: Cube 27', 'We can cancel the fans but keep the cube as quoted.')
  check('"cancel the fans, keep the cube" → REMOVE_ITEMS not CANCEL', r?.kind === 'REMOVE_ITEMS', r)
}
{
  const r = sig('Re: Order', "Turns out we won't need the second trailer after all.")
  check('"won\'t need the second trailer" → REMOVE_ITEMS', r?.kind === 'REMOVE_ITEMS', r)
}
{
  const r = sig('Re: Shoot', 'Bad news, we are cancelling the shoot — please remove the fans and the cube from the order.')
  check('whole-shoot cancel with item words → CANCEL', r?.kind === 'CANCEL', r)
}
{
  const r = sig('Re: Booking', 'Cancel the cube.')
  check('"cancel the cube" is an item drop, the rep decides if it is the job', r?.kind === 'REMOVE_ITEMS', r)
}

console.log('must not raise')
{
  const r = sig('Re: Quote', 'Looks great, send over the contract and we will get it signed today.')
  check('booking signal → null', r === null, r)
}
{
  const r = sig('Re: COI', 'Attached is the COI. Let me know if anything else is needed.')
  check('paperwork → null', r === null, r)
}
{
  const r = sig('Re: Quote', 'Can you push the quote through to accounting? They need it today.')
  check('"push the quote" (not a date) → null', r === null, r)
}
{
  const r = sig('Re: Van', 'Please move the truck to bay 2 when it arrives.')
  check('"move the truck" (not dates) → null', r === null, r)
}
{
  const r = sig('Re: Call sheet', 'Can you add me to the call sheet distro list? Thanks.')
  check('"add me to the call sheet" (not an item) → null', r === null, r)
}
{
  const r = sig('Re: Delivery', 'Drop it at the gate, security will let you in.')
  check('"drop it at the gate" (not a removal) → null', r === null, r)
}
{
  const r = sig('Re: Van', 'Sounds good.\n\nOn Tue, Sep 9, 2026 at 3:12 PM Jose <jose@sirreel.com> wrote:\n> If the shoot is cancelled just let us know.')
  check('cancel only inside the quoted reply → null', r === null, r)
}
{
  const r = sig('Re: Quote', 'Thanks, will review.', { replyClassification: 'PURE_ACKNOWLEDGMENT', messageNature: 'reply' })
  check('acknowledgment + benign nature → null', r === null, r)
}

console.log('')
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1) }
console.log('all checks passed')
