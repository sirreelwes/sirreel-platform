/**
 * How a stored COI review is read.
 *
 *   npx tsx tests/coi/checks.test.ts
 *   npm run test:coi-checks
 *
 * Pure + offline: no DB, no AI, no env.
 *
 * The whole point of unifying the prompts is that a certificate cannot read
 * as "passes the checks" on questions nobody asked. Four generations of
 * review shape sit in the database; these are the two directions of
 * wrongness that matter:
 *   - an unasked requirement must NEVER count as a pass (that is how a truck
 *     leaves the yard on a certificate with no physical damage coverage)
 *   - a human's sign-off and a client-facing demand must never be produced
 *     from a field the review never populated
 */

import {
  coiChecklist,
  coiFlags,
  coiAdditionalInsured,
  coiCheckWriteFields,
  hasCoiChecklist,
} from '../../src/lib/coi/checks'
import { normalizeCoiReview, CRITICAL_CHECK_KEYS, ALERT_CHECK_KEYS } from '../../src/lib/coi/reviewCoi'
import { evaluateHolderMatch } from '../../src/lib/coi/holderMatch'

const failures: string[] = []
function check(why: string, got: boolean): void {
  if (got) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const pass = { pass: true, found: '$1,000,000', note: '' }
const fail = { pass: false, found: '', note: 'Not shown on the certificate.' }

/** A complete, everything-met review in today's shape. */
function fullReview(overrides: Record<string, unknown> = {}) {
  const r: Record<string, unknown> = { namedInsured: 'Acme Films, LLC', policyExpiryDate: '2027-01-01' }
  for (const k of CRITICAL_CHECK_KEYS) r[k] = { ...pass }
  for (const k of ALERT_CHECK_KEYS) r[k] = { ...pass }
  r.policyExpiry = { pass: true, date: '2027-01-01', expired: false }
  r.certificateHolder = { pass: true, found: 'SirReel Production Vehicles, Inc., 8500 Lankershim Blvd, Sun Valley, CA 91352', note: '' }
  return { ...r, ...overrides }
}

console.log('COI stored-review reading\n')

// ── Today's shape ────────────────────────────────────────────────────────
const clean = coiFlags(fullReview())
check('a complete certificate passes everything', clean.criticalPass && clean.alertPass && clean.overallPass)
check('a complete certificate is low risk', clean.riskLevel === 'low')

// P&NC is broker-fixable and tiered ALERT, same as the paperwork portal —
// worth asking for on every certificate that lacks it, not a gate.
const noPnc = coiFlags(fullReview({ primaryNonContributory: { ...fail } }))
check(
  'a missing P&NC is raised without failing the certificate',
  noPnc.criticalPass && !noPnc.alertPass && noPnc.riskLevel === 'medium',
)

const noUmbrella = coiFlags(fullReview({ umbrella: { ...fail } }))
check(
  'a missing umbrella is a judgment call, not a blocker',
  noUmbrella.criticalPass && !noUmbrella.alertPass && noUmbrella.riskLevel === 'medium',
)

// An expired policy fails no matter what `pass` says beside it.
const expired = coiFlags(fullReview({ policyExpiry: { pass: true, date: '2020-01-01', expired: true } }))
check('an expired policy fails even when the model marked it pass', !expired.criticalPass)

// THE case the unification exists for.
const unasked = fullReview()
delete (unasked as Record<string, unknown>).lossPayee
const missingKey = coiFlags(unasked)
check(
  'a requirement the review never judged is not a pass',
  !missingKey.criticalPass && missingKey.criticalOpen.some((r) => r.key === 'lossPayee'),
)
check(
  'an unjudged requirement is reported as UNKNOWN, not FAIL',
  coiChecklist(unasked).find((r) => r.key === 'lossPayee')?.status === 'UNKNOWN',
)

// ── The old flat-boolean shape ───────────────────────────────────────────
const legacy = {
  overallPass: true,
  coverageVerified: true,
  additionalInsured: true,
  autoPhysicalDamage: true,
  riskLevel: 'low',
  notes: 'All critical requirements met.',
}
check('a pre-checklist review is recognised as having no checklist', !hasCoiChecklist(legacy))
const legacyFlags = coiFlags(legacy)
check(
  'a pre-checklist review never reads as a full pass',
  legacyFlags.criticalPass && !legacyFlags.alertPass && !legacyFlags.overallPass,
)
check('a pre-checklist review yields no checklist rows to display', !legacyFlags.hasChecklist)

const legacyBad = coiFlags({ ...legacy, overallPass: false })
check('a failed pre-checklist review is high risk', !legacyBad.criticalPass && legacyBad.riskLevel === 'high')

// additionalInsured is an object today and a bare boolean on old rows.
check('additionalInsured reads from the object shape', coiAdditionalInsured(fullReview()))
check('additionalInsured reads from the legacy boolean', coiAdditionalInsured(legacy))
check('additionalInsured is false when the check failed', !coiAdditionalInsured(fullReview({ additionalInsured: { ...fail } })))

// ── Normalizer ───────────────────────────────────────────────────────────
const normalized = normalizeCoiReview(fullReview({ riskLevel: 'high', overallPass: false }) as never)
check(
  'the rollups are recomputed, not trusted from the model',
  normalized.criticalPass === true && normalized.overallPass === true && normalized.riskLevel === 'low',
)
check(
  'the expiry is lifted out of the policyExpiry block',
  normalizeCoiReview({ policyExpiry: { date: '2027-03-04', expired: false, pass: true } } as never)
    .policyExpiryDate === '2027-03-04',
)
check(
  'a junk expiry is dropped rather than stored',
  normalizeCoiReview({ policyExpiryDate: 'sometime in March' } as never).policyExpiryDate === null,
)
check(
  'an ungraded response leaves the rollups alone rather than inventing a pass',
  normalizeCoiReview({ notes: 'AI review failed: timeout' } as never).criticalPass === undefined,
)

// ── What gets written to the row ─────────────────────────────────────────
const written = coiCheckWriteFields(fullReview() as never)
check('a clean certificate is recommended for acceptance', written.aiRecommendation === 'accept')
check('the insured name is captured verbatim', written.namedInsured === 'Acme Films, LLC')
check(
  'an alert-only gap still recommends acceptance',
  coiCheckWriteFields(fullReview({ workersComp: { ...fail } }) as never).aiRecommendation === 'accept',
)
check(
  'a critical gap sends it to review',
  coiCheckWriteFields(fullReview({ lossPayee: { ...fail } }) as never).aiRecommendation === 'review',
)

// ── Certificate holder: decided in code, not by the model ────────────────
// SirReel trades under several names. The model's boolean contradicted its
// own note on these (twice in six runs on a live certificate), so the text is
// the input and the verdict is computed.
for (const name of [
  'SirReel Production Vehicles, Inc., 8500 Lankershim Blvd, Sun Valley, CA 91352',
  'SirReel Production Vehicles, Inc. dba SirReel Studio Rentals, 8500 Lankershim Blvd, Sun Valley, CA 91352',
  'SirReel Studio Services, 8500 Lankershim Blvd, Sun Valley, CA 91352',
  'SirReel Studio Rentals\n8500 Lankershim Blvd\nSun Valley, CA 91352',
  'Sir Reel Production Vehicles Inc 8500 Lankershim Blvd Sun Valley CA 91352',
  'SirReel Studio Services',
]) {
  check(`holder accepted: ${name.slice(0, 44).replace(/\n/g, ' ')}`, evaluateHolderMatch(name).verdict === 'MATCH')
}
check(
  'a different company at our address is rejected',
  evaluateHolderMatch('Quixote Studios, 8500 Lankershim Blvd, Sun Valley, CA 91352').verdict === 'WRONG_COMPANY',
)
check(
  'SirReel at someone else\'s address is rejected',
  evaluateHolderMatch('SirReel Studio Rentals, 1200 Vine St, Hollywood, CA 90038').verdict === 'WRONG_ADDRESS',
)
check('an unreadable holder box needs a human', evaluateHolderMatch('').verdict === 'UNKNOWN')

// The model's own boolean must not be able to override the computed verdict —
// this is the exact shape of the live failure.
const contradicted = normalizeCoiReview(
  fullReview({
    certificateHolder: {
      pass: false,
      found: 'SirReel Studio Services, 8500 Lankershim Blvd, Sun Valley, CA 91352',
      note: 'Certificate Holder name is acceptable and address is correct.',
    },
  }) as never,
)
check(
  'a self-contradicting holder verdict is overruled by the computed one',
  (contradicted.certificateHolder as { pass?: boolean })?.pass === true && contradicted.criticalPass === true,
)
const wrongHolder = normalizeCoiReview(
  fullReview({ certificateHolder: { pass: true, found: 'Quixote Studios, 1000 N Cahuenga Blvd' } }) as never,
)
check(
  'a genuinely wrong holder fails even when the model passed it',
  (wrongHolder.certificateHolder as { pass?: boolean })?.pass === false && wrongHolder.criticalPass === false,
)

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All COI stored-review checks passed.')
