/**
 * "Ask the client for another card" — the rule behind the button.
 *
 *   npx tsx tests/payments/card-ask.test.ts
 *   npm run test:card-ask
 *
 * Pure + offline. Wes 2026-09-18: Jose keyed a card, it declined, and there
 * was no way to ask for a new one. Both failure directions cost something:
 *
 *   - Missing the ask is the bug being fixed. A declined card reads "On file"
 *     on every staff surface and fails at charge time, on pickup morning.
 *   - A FALSE ask emails a client that their good card was refused. That is
 *     worse than silence — it is us telling a production's accounting contact
 *     something untrue about their bank.
 *
 * So the states are pinned in both directions, and so is the sentence the
 * client actually reads: the whole point of the replacement wording is that
 * "we need a credit card on file" never goes to somebody who gave us one.
 */

import {
  cardAskState,
  cardAskClientSentence,
  clientCardWasDeclined,
  isCardUsable,
  replacementNeeded,
  CARD_DECLINED_AT_SUBMIT,
  CARD_DECLINED_ON_FILE,
  type CardAskInput,
  type CardAskReason,
} from '../../src/lib/payments/cardAsk'
import { defaultEmailBody } from '../../src/lib/email/standardOpening'

const failures: string[] = []

function check(
  card: CardAskInput | null,
  want: { ask: boolean; reason: CardAskReason; replacement: boolean },
  why: string,
): void {
  const got = cardAskState(card)
  if (got.ask === want.ask && got.reason === want.reason && got.replacement === want.replacement) {
    console.log(`  ok — ${why}`)
  } else {
    failures.push(
      `${why}: got ${got.reason} (ask=${got.ask}, replacement=${got.replacement}), wanted ${want.reason} (ask=${want.ask}, replacement=${want.replacement})`,
    )
  }
}

function assert(cond: boolean, why: string): void {
  if (cond) console.log(`  ok — ${why}`)
  else failures.push(why)
}

console.log('Card ask — when, and what it is called\n')

// No card at all. MISSING, not NONE: "nothing to ask for" and "nobody has
// been asked" are opposite states.
check(null, { ask: true, reason: 'MISSING', replacement: false }, 'no card → the original ask')
check(
  undefined as unknown as null,
  { ask: true, reason: 'MISSING', replacement: false },
  'undefined card → the original ask',
)
check(
  { onFile: false },
  { ask: true, reason: 'MISSING', replacement: false },
  'onFile false → the original ask',
)

// A live card is not an ask. This is the direction that must never produce a
// false positive — the email it would send is about a card that is fine.
check(
  { onFile: true, validated: true, expired: false },
  { ask: false, reason: 'NONE', replacement: false },
  'validated, unexpired card → nothing to ask for',
)

// The bug. SR-JOB-0260 sat for two days reading "On file" with a card the
// gateway had refused.
check(
  { onFile: true, validated: false, expired: false },
  { ask: true, reason: 'DECLINED', replacement: true },
  'the $0 check was refused → ask for another, as a replacement',
)
check(
  { onFile: true, validated: true, expired: true },
  { ask: true, reason: 'EXPIRED', replacement: true },
  'validated once, MM/YY now past → ask for another',
)
// Both at once is the usual shape — an expired card also fails the $0 check.
// DECLINED wins, which keeps the sharper fact in front of the rep and matches
// what the job tile has said since 2026-09-01.
check(
  { onFile: true, validated: false, expired: true },
  { ask: true, reason: 'DECLINED', replacement: true },
  'declined AND expired → declined wins',
)

// An UNKNOWN validation is not a decline: only an explicit false is.
//
// Note what this does and does not buy today. The two readers that feed this
// rule — listCompanyCards and resolveWalletCardForJob — both collapse a null
// `authRespStat` to `validated: false`, so a legacy row that predates the $0
// check reaches here as DECLINED and gets the ask. That is deliberately the
// SAME reading those surfaces already publish (the wallet's "Unvalidated"
// chip, and the tile line "The $0 check was not approved — ask for another
// card", both live since 2026-09-01) — this feature adds the button next to
// that sentence, it does not re-litigate the sentence. The distinction is
// kept here so that a caller who CAN tell "never checked" from "refused"
// gets the right answer without this rule having to change.
check(
  { onFile: true },
  { ask: false, reason: 'NONE', replacement: false },
  'validation not supplied at all → not read as a decline',
)
check(
  { onFile: true, validated: null, expired: null },
  { ask: false, reason: 'NONE', replacement: false },
  'explicit null validation/expiry → not read as a decline',
)

console.log('\nWhat the client is told\n')

assert(
  cardAskClientSentence('MISSING', 'Party Giraffes') === null,
  'MISSING has no replacement sentence — the standard ask stands',
)
assert(
  cardAskClientSentence('NONE', 'Party Giraffes') === null,
  'NONE has no replacement sentence',
)

const declined = cardAskClientSentence('DECLINED', 'Party Giraffes') ?? ''
assert(declined.includes('Party Giraffes'), 'the declined sentence names the production')
assert(
  declined.includes('did not go through'),
  'the declined sentence says the card did not go through',
)
assert(
  !/declin|refus|bank|insufficient/i.test(declined),
  'it does NOT guess why — we do not know, and their bank will not tell us',
)

const expired = cardAskClientSentence('EXPIRED', null) ?? ''
assert(expired.includes('your production'), 'no job name falls back to "your production"')
assert(expired.includes('has expired'), 'the expired sentence says the card expired')

console.log('\nThe body a rep is handed, and the client receives\n')

const standard = defaultEmailBody({
  kind: 'card-auth',
  projectName: 'Party Giraffes',
  agentFirstName: 'Jose',
})
assert(
  standard.includes('we need a credit card on file'),
  'with no card on file, the ask is unchanged',
)

const replacementBody = defaultEmailBody({
  kind: 'card-auth',
  projectName: 'Party Giraffes',
  agentFirstName: 'Jose',
  cardAskReason: 'DECLINED',
})
assert(
  !replacementBody.includes('we need a credit card on file'),
  'a replacement ask never tells a client who gave us a card that we need one',
)
assert(
  replacementBody.includes('did not go through'),
  'a replacement ask says what happened to the card they gave us',
)
assert(
  replacementBody.includes('Questions? Just reply to this email — Jose'),
  'the closer, and the agent in it, survive the swap',
)

// MISSING and NONE must leave the body byte-for-byte as it was, or every
// ordinary card request changes wording for no reason.
for (const reason of ['MISSING', 'NONE'] as CardAskReason[]) {
  const body = defaultEmailBody({
    kind: 'card-auth',
    projectName: 'Party Giraffes',
    agentFirstName: 'Jose',
    cardAskReason: reason,
  })
  assert(body === standard, `cardAskReason ${reason} leaves the standard ask untouched`)
}

console.log('\nWhat the CLIENT is told in their own portal\n')

// The hazard this field exists for. `validated: false` covers two different
// facts and only one of them may ever reach a client: every card stored
// before the $0 check shipped (2026-09-01) has a null authRespStat, so it
// arrives here as validated:false / authChecked:false. Calling that a
// decline would tell a production's accounting desk their working card was
// refused by their bank — a false alarm worse than the silence it replaces.
assert(
  clientCardWasDeclined({ authChecked: true, validated: false }) === true,
  'asked the gateway and told no → declined',
)
assert(
  clientCardWasDeclined({ authChecked: false, validated: false }) === false,
  'NEVER CHECKED is not a decline — the legacy-card false alarm',
)
assert(
  clientCardWasDeclined({ authChecked: true, validated: true }) === false,
  'approved card is not declined',
)
assert(
  clientCardWasDeclined({}) === false,
  'a card carrying neither field says nothing — fails quiet, not loud',
)
assert(
  clientCardWasDeclined({ validated: false }) === false,
  'validated:false ALONE never reads as a decline',
)

// Both notices have the same job, so both must do all three things. A client
// who is not told nothing was charged phones the desk; one who is not told
// their signature survived redoes the whole step.
for (const [name, text] of [
  ['at submit', CARD_DECLINED_AT_SUBMIT],
  ['on file', CARD_DECLINED_ON_FILE],
] as const) {
  assert(/did not approve/i.test(text), `${name}: says the bank did not approve it`)
  assert(/nothing was charged/i.test(text), `${name}: says nothing was charged`)
  assert(/different card/i.test(text), `${name}: asks for a different card`)
  // Same rule as the staff-side sentence: we do not know why, and the
  // client's bank will not tell us. Guessing at a production's A/P desk is
  // its own phone call.
  assert(
    !/insufficient|expired|funds|fraud|frozen|limit|stolen/i.test(text),
    `${name}: does NOT guess why the bank refused it`,
  )
}
assert(
  /signature/i.test(CARD_DECLINED_AT_SUBMIT),
  'at submit: says the signature survived, so nobody redoes the step',
)
assert(
  /stays on file/i.test(CARD_DECLINED_ON_FILE),
  'on file: says the dead card is not being removed underneath them',
)

console.log('\nWhich card will charge, and who chases it\n')

const GOOD = { authChecked: true, validated: true, expired: false }
const REFUSED = { authChecked: true, validated: false, expired: false }
const STALE = { authChecked: true, validated: true, expired: true }
// The shape most of this board is actually in: authorization lives in
// Cognito or RentalWorks, so HQ has no gateway answer at all.
const UNCHECKED = { authChecked: false, validated: false, expired: false }

assert(isCardUsable(GOOD) === true, 'approved and current → usable')
assert(isCardUsable(REFUSED) === false, 'refused → not usable')
assert(isCardUsable(STALE) === false, 'expired → not usable')
assert(
  isCardUsable(UNCHECKED) === true,
  'NEVER CHECKED is usable — 21 of 23 bookings were in this state on 2026-09-06',
)
assert(isCardUsable({}) === true, 'a card with nothing recorded is not presumed dead')

// The three-way split. Getting the first case wrong double-reports every
// cardless job; getting the third wrong nags a client who already fixed it.
assert(
  replacementNeeded([]) === false,
  'NO cards is card-required’s row, never this one',
)
assert(replacementNeeded([REFUSED]) === true, 'one refused card → chase a replacement')
assert(replacementNeeded([STALE]) === true, 'one expired card → chase a replacement')
assert(
  replacementNeeded([REFUSED, GOOD]) === false,
  'they already added a good card → nothing to chase, dead one left alone',
)
assert(
  replacementNeeded([REFUSED, STALE]) === true,
  'two bad cards is still no working card',
)
assert(
  replacementNeeded([UNCHECKED]) === false,
  'an unvalidated legacy card must NOT raise this item',
)
assert(
  replacementNeeded([REFUSED, UNCHECKED]) === false,
  'a refused card beside an unchecked one clears — we cannot say the other is dead',
)

console.log('')
if (failures.length) {
  console.error(`FAILED (${failures.length}):`)
  failures.forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
console.log('All card-ask cases pass.')
