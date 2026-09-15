/**
 * The plain-words terms card must never promise more than the agreement says.
 *
 *   npm run test:partner-terms
 *
 * Wes 2026-09-15: "we haven't created the terms clearly for them." The card
 * (partnerTerms.ts) restates clauses 2, 4, 8 and 10; this reads the REAL
 * clause bodies of both agreement variants and fails when a number or a
 * promise on the card stops appearing there.
 */
import { partnerTerms } from '@/lib/sub-rentals/partnerTerms'
import { vendorAgreementFor } from '@/lib/contracts/vendorAgreementClauses'

let fail = 0
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (!cond) fail++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`)
}

for (const kind of ['VEHICLES', 'EQUIPMENT'] as const) {
  const text = vendorAgreementFor(kind)
  const clause = (ref: string) => text.clauses.find((c) => c.ref === ref)?.body ?? ''
  const terms = partnerTerms({ kind, sharePercent: 10 })
  const term = (k: string) => terms.find((t) => t.key === k)!

  console.log(`\n${kind}`)
  ok('every term names a clause that exists', terms.every((t) => clause(t.section).length > 0), terms.map((t) => t.section))
  ok('rates: 10% to SirReel, 90% to the partner', /SirReel keeps 10%/.test(term('rates').body) && /you receive 90%/.test(term('rates').body))
  ok('payment timing matches clause 8 (30 days / 10 business days / whichever is later)',
    /30 days after your invoice or 10 business days after the production pays SirReel, whichever is later/.test(term('payment').body)
    && /later of 30 days after it receives a correct invoice and 10 business days after it receives the production’s payment/.test(clause('8')))
  ok('never invoice the production — clause 8 says so too', /never invoice/.test(term('payment').body) && /will not invoice, quote or collect from a production/.test(clause('8')))
  ok('24-hour late cancel = one day, as clause 2', /less than 24 hours/.test(term('bookings').body) && /less than 24 hours before the scheduled/.test(clause('2')) && /one day at the booked rate/.test(clause('2')))
  ok('the cancel trigger word matches the clause (pickup vs delivery)', clause('2').includes(`scheduled ${kind === 'EQUIPMENT' ? 'delivery' : 'pickup'}`) && term('bookings').body.includes(`scheduled ${kind === 'EQUIPMENT' ? 'delivery' : 'pickup'}`))
  ok('nothing held until they confirm — clause 2', /Nothing is held until you confirm/.test(term('bookings').body) && /you confirm the (Vehicle|Unit) is held/.test(clause('2')))
  ok('insurance: partner keeps their own and gives a certificate — clause 4', /keep your own insurance/.test(term('insurance').body) && /certificate of insurance when you sign/.test(clause('4')))
  ok('listings: withdraw any time, no name or logo — clause 10', /pull any of them at any time/.test(term('listings').body) && /withdraw for any (Vehicle|Unit) at any time/.test(clause('10')) && /name, logo or trademarks/.test(clause('10')))
}

console.log('\nunset deal')
const unset = partnerTerms({ kind: 'VEHICLES', sharePercent: null })
ok('no percentage is invented before a deal is set', !/\d+%/.test(unset.find((t) => t.key === 'rates')!.body))
ok('a flexing partner hears the shared-discount rule', /shared equally with SirReel until SirReel's share reaches 20%/.test(partnerTerms({ kind: 'VEHICLES', sharePercent: 10, maxSharePercent: 20 }).find((t) => t.key === 'discounts')!.body))
ok('otherwise the discount is SirReel’s', /comes out of SirReel's share, not yours/.test(partnerTerms({ kind: 'VEHICLES', sharePercent: 10 }).find((t) => t.key === 'discounts')!.body))

if (fail) { console.log(`\n${fail} failing`); process.exit(1) }
console.log('\nall passing')
