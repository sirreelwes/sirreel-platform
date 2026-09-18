/**
 * Company merge — the decisions made before anything is written.
 *
 * Origin (2026-09-18): the COI review desk moved a job, its order, three
 * bookings and the certificate onto a second Company row for the same
 * client, leaving the card on file and the contact behind on the first.
 * Merging them needed a laptop and a tsx script, so the merge moved into
 * the CRM — and these are the three judgements that merge makes without
 * asking a human:
 *
 *   · which duplicate records to OFFER (nearDuplicateKey)
 *   · which Affiliation survives a collision (planAffiliationCollisions)
 *   · which keeper fields get filled in (planBackfill)
 *
 * The stakes are asymmetric in both directions. Offering too little is
 * why High Horse / High Horses existed at all; offering too much puts a
 * one-click destructive action next to two real, different clients.
 * Backfill overwriting a keeper value would silently rewrite a live
 * client's billing email from a stale duplicate.
 *
 * Run: npm run test:company-merge
 */
import {
  nearDuplicateKey,
  isNearDuplicateName,
  planAffiliationCollisions,
  planBackfill,
  affiliationScore,
  type AffiliationForMerge,
} from '@/lib/companies/mergeCompanies'
import { companyNamesMatch } from '@/lib/companies/normalize'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

// ── Which records get OFFERED as duplicates ──────────────────────────
// The pair that started this. companyNameKey (the create-time guard)
// says these are different companies, and at create time that is the
// right call — this looser key exists only to offer the merge.
eq('High Horse ↔ High Horses', isNearDuplicateName('High Horse', 'High Horses'), true)
eq('plural + legal suffix', isNearDuplicateName('High Horses LLC', 'High Horse'), true)
eq('Crazy Maple Studio ↔ Crazy Maple Studios', isNearDuplicateName('Crazy Maple Studio', 'Crazy Maple Studios'), true)
// The bug this guards: folding plurals AFTER companyNameKey left
// "cms pictures" as "cms" and "CMS Picture Inc." as "cms picture".
eq('punctuation + case + a suffix that is only plural in the list',
  isNearDuplicateName('CMS Picture Inc.', 'cms pictures'), true)

// Generic industry suffixes fold, so two names that differ ONLY in that
// suffix are offered: "Apex Films" and "Apex Media" both reduce to
// "apex". That is inherited from companyNameKey, not invented here — it
// is the same rule that stops the pair being created separately in the
// first place — and it is asserted so the inheritance is deliberate.
// The merge still takes three steps and a dry run before it writes.
eq('Apex Films ↔ Apex Media (suffix fold, offered)', isNearDuplicateName('Apex Films', 'Apex Media'), true)
eq('…and the strict create-time guard agrees', companyNamesMatch('Apex Films', 'Apex Media'), true)

// Must NOT be offered — different clients that merely rhyme. A false
// offer here sits one click from deleting a real account.
eq('High Horse ↔ High Road', isNearDuplicateName('High Horse', 'High Road'), false)
eq('Apex Films ↔ Apogee Films', isNearDuplicateName('Apex Films', 'Apogee Films'), false)
eq('Horse Productions ↔ Horseshoe Productions',
  isNearDuplicateName('Horse Productions', 'Horseshoe Productions'), false)
eq('empty names never match', isNearDuplicateName('', ''), false)
eq('suffix-only names never match', isNearDuplicateName('Productions', 'Studios'), false)

// Short words and double-s survive the plural fold: trimming these
// would collapse genuinely different names.
eq('Express keeps its s', nearDuplicateKey('Express'), 'express')
eq('Cross keeps its s', nearDuplicateKey('Cross'), 'cross')
eq('Bus keeps its s (too short to fold)', nearDuplicateKey('Bus'), 'bus')

// ── Which Affiliation survives a collision ───────────────────────────
const KEEPER = 'keeper-co'
const DUP = 'dup-co'
let n = 0
const aff = (over: Partial<AffiliationForMerge>): AffiliationForMerge => ({
  id: `a${++n}`,
  personId: 'person-1',
  companyId: DUP,
  productionName: null,
  roleOnShow: null,
  notes: null,
  startDate: null,
  endDate: null,
  totalSpend: 0,
  totalBookings: 0,
  createdAt: new Date('2026-01-01'),
  ...over,
})

// A pre-existing link on the keeper is never the one deleted, even when
// the duplicate's row is richer — deleting it would take a live link out
// from under whatever already references the keeper.
{
  const keeperRow = aff({ id: 'keep-me', companyId: KEEPER })
  const richerDup = aff({ id: 'drop-me', roleOnShow: 'Producer', notes: 'knows Julian', totalBookings: 4 })
  const plan = planAffiliationCollisions([richerDup, keeperRow], KEEPER)
  eq('keeper row wins a collision outright', plan.dropIds, ['drop-me'])
  eq('richer duplicate scores higher (and still loses)',
    affiliationScore(richerDup) > affiliationScore(keeperRow), true)
}

// Two duplicates, neither on the keeper: the richer row survives.
{
  const thin = aff({ id: 'thin' })
  const rich = aff({ id: 'rich', roleOnShow: 'PM', totalSpend: 4200 })
  eq('richer of two duplicates survives', planAffiliationCollisions([thin, rich], KEEPER).dropIds, ['thin'])
}

// Different productions for the same person are NOT a collision — the
// unique key is (personId, companyId, productionName).
{
  const a = aff({ id: 'txu', productionName: 'TXU' })
  const b = aff({ id: 'other', productionName: 'Something Else' })
  eq('different productions both survive', planAffiliationCollisions([a, b], KEEPER).dropIds, [])
}

// Decimal-shaped spend (what Prisma actually hands us) must score.
{
  const decimalish = aff({ id: 'dec', totalSpend: { toNumber: () => 1200 } })
  eq('Decimal spend counts toward the score', affiliationScore(decimalish) >= 16, true)
}

// ── Keeper backfill ──────────────────────────────────────────────────
{
  const keeper = {
    id: 'k', name: 'High Horses', notes: 'created from new-job lead',
    billingEmail: 'ap@highhorses.com', website: null, rentalworksCustomerId: null,
  }
  const dup = {
    id: 'd', name: 'High Horse', notes: 'whatever',
    billingEmail: 'stale@old.com', website: 'highhorse.com', rentalworksCustomerId: 'RW-99',
  }
  const backfill = planBackfill(keeper, [dup], '2026-09-18')
  eq('keeper billing email is NOT overwritten', backfill.billingEmail, undefined)
  eq('null website is filled from the duplicate', backfill.website, 'highhorse.com')
  eq('null RW id is filled from the duplicate', backfill.rentalworksCustomerId, 'RW-99')
  eq('name is never backfilled', backfill.name, undefined)
  eq('merge note appended to existing notes',
    backfill.notes,
    'created from new-job lead\n\nMerged 1 duplicate company records on 2026-09-18: High Horse (d).')
}
{
  // Empty string counts as absent on both sides — a blank website should
  // be filled, and should never be donated as if it were a value.
  const backfill = planBackfill(
    { id: 'k', name: 'K', notes: null, website: '' },
    [{ id: 'd1', name: 'D1', website: '' }, { id: 'd2', name: 'D2', website: 'real.com' }],
    '2026-09-18',
  )
  eq('blank donor is skipped for a real one', backfill.website, 'real.com')
  eq('merge note stands alone when keeper had no notes',
    backfill.notes,
    'Merged 2 duplicate company records on 2026-09-18: D1 (d1); D2 (d2).')
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
