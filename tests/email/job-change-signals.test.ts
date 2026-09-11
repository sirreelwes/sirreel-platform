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
