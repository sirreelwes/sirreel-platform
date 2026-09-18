/**
 * "Is there something to sign?" — the third state of a company annual.
 *
 *   npx tsx tests/portal/annual-signing-state.test.ts
 *   npm run test:annual-signing
 *
 * Pure + offline. This rule exists because the account model had TWO states
 * — signs per job, or covered by a signed annual — and on 2026-09-18 a third
 * one was filed into production: **covering, unsigned, offered.** A master
 * filed with `autoCoverJobs: true` papers every job in its window with
 * nobody's name on it, which is exactly what Graduation Day Productions and
 * Party Giraffes now carry.
 *
 * Three surfaces read coverage as proof of a signature, and each failed in a
 * way that cost the signature itself:
 *
 *   - the account portal's terms card (`terms.annual ? … : terms.pendingAnnual ? …`)
 *     showed "Annual agreement active · Read the agreement" and NO Sign
 *     button, to the executive who opened the portal to sign;
 *   - the invite composer gated the link on `!annual && pending`, so the
 *     email to that executive named no document and carried no sign link;
 *   - the sign page answered a direct link with "Your account already has a
 *     signed annual agreement … Nothing to sign." — over a document nobody
 *     had signed.
 *
 * So the expensive direction here is a false "nothing to sign": it is
 * unfalsifiable from the client's side (they see a tidy, confident screen)
 * and it leaves the terms in force with no signature behind them, which is
 * the whole reason the offer was filed.
 */

import { annualSigningState } from '../../src/lib/portal/annualSigningRules'

const failures: string[] = []

function check(cond: boolean, why: string): void {
  if (cond) console.log(`  ok — ${why}`)
  else failures.push(why)
}

const offer = { id: 'ca_offer', title: '2026 Negotiated Rental Agreement' }

// ── 1. Covering, unsigned, offered — the state that broke all three ────
{
  const s = annualSigningState({
    coverage: { title: '2026 Negotiated Rental Agreement', signerName: null, signedAt: null, expiryDate: '2026-12-31' },
    pending: offer,
  })
  check(s.signable === offer, 'an unsigned covering master does NOT hide the offer')
  check(s.executed === null, 'coverage with no signature is not "executed"')
  check(s.coveringUnsigned === true, 'and the surfaces are told the terms are already in force')
}

// ── 2. Genuinely executed, nothing offered — the only "nothing to sign" ──
{
  const s = annualSigningState({
    coverage: { title: 'Annual', signerName: 'Haylea', signedAt: new Date('2026-09-20'), expiryDate: '2026-12-31' },
    pending: null,
  })
  check(s.signable === null, 'a signed annual with no offer waiting has nothing to sign')
  check(s.executed?.signerName === 'Haylea', 'and the signer is named back')
  check(s.coveringUnsigned === false, 'nothing is owed')
}

// ── 3. Next year's offered while this year's signed copy still holds ────
//     A real case, not a mistake to guard against: the desk pressed Offer,
//     and signAnnual only ever supersedes masters nobody signed.
{
  const s = annualSigningState({
    coverage: { title: '2026 Annual', signerName: 'Haylea', signedAt: new Date('2026-09-20'), expiryDate: '2026-12-31' },
    pending: { id: 'ca_2027', title: '2027 Annual Rental Agreement' },
  })
  check(s.signable?.id === 'ca_2027', "next year's offer is signable even while this year's is executed")
  check(s.executed !== null, 'and the executed copy is still reported, for context')
  check(s.coveringUnsigned === false, 'this coverage IS signed, so nothing says otherwise')
}

// ── 4. No coverage at all ───────────────────────────────────────────────
{
  const bare = annualSigningState({ coverage: null, pending: null })
  check(bare.signable === null && bare.executed === null && !bare.coveringUnsigned, 'an account with no annual is all three nulls')

  const offered = annualSigningState({ coverage: null, pending: offer })
  check(offered.signable === offer, 'a first offer on an uncovered account is signable')
  check(offered.coveringUnsigned === false, 'nothing is in force yet, so nothing claims to be')
}

// ── 5. Dates arrive as strings from the portal, Dates from Prisma ───────
//     Only the PRESENCE of signedAt decides anything, so both shapes must
//     answer identically — the sign page reads JSON, the composer reads rows.
{
  const asString = annualSigningState({
    coverage: { title: 'A', signerName: 'X', signedAt: '2026-09-20T00:00:00.000Z', expiryDate: '2026-12-31' },
    pending: null,
  })
  check(asString.executed !== null, 'an ISO string signedAt reads as executed, same as a Date')
}

if (failures.length) {
  console.error(`\n${failures.length} assertion(s) failed:`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nall good')
