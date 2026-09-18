/**
 * The unsigned-partner gate (2026-09-18 — Wes: "go ahead with the
 * unsigned-partner gate").
 *
 * What this protects is an allocation of RISK, not a display: §32 of the
 * rental agreement supplies a partner's unit to the client on SirReel's own
 * terms, and on Graduation Day's negotiated version we answer for the
 * partner's testing and their crew. The partner agreement's §6 and §11 are
 * what carry that back to them — so "has this partner signed" is the
 * question standing between a promise and nothing behind it.
 *
 * The pure half is asserted here. Every case below is a state a real vendor
 * row can be in.
 *
 * Run: npm run test:partner-paper
 */
import {
  partnerPaperStatus,
  blocksBooking,
  partnerPaperMessage,
  type UnpaperedPartner,
} from '@/lib/sub-rentals/partnerPaperGate'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)

const NOW = new Date('2026-09-18T12:00:00Z')
const d = (s: string) => new Date(`${s}T00:00:00Z`)

// ── The verdict on one partner's paper ────────────────────────────────────
eq('no agreement at all', partnerPaperStatus([], NOW), 'none')
eq(
  'filed but never signed',
  partnerPaperStatus([{ signedAt: null, effectiveDate: null, expiryDate: null }], NOW),
  'unsigned',
)
eq(
  'signed, open-ended',
  partnerPaperStatus([{ signedAt: d('2026-09-01'), effectiveDate: null, expiryDate: null }], NOW),
  'signed',
)
eq(
  'signed and current',
  partnerPaperStatus([{ signedAt: d('2026-01-02'), effectiveDate: d('2026-01-01'), expiryDate: d('2026-12-31') }], NOW),
  'signed',
)
eq(
  'signed but lapsed',
  partnerPaperStatus([{ signedAt: d('2025-01-02'), effectiveDate: d('2025-01-01'), expiryDate: d('2025-12-31') }], NOW),
  'expired',
)
// Both ends inclusive of the calendar DAY — the same reading a company's
// annual master gets in annualCoverage.ts. An agreement expiring today
// still covers a booking made today.
eq(
  'expires TODAY — still covering',
  partnerPaperStatus([{ signedAt: d('2026-01-02'), effectiveDate: null, expiryDate: d('2026-09-18') }], NOW),
  'signed',
)
eq(
  'expired YESTERDAY',
  partnerPaperStatus([{ signedAt: d('2026-01-02'), effectiveDate: null, expiryDate: d('2026-09-17') }], NOW),
  'expired',
)
eq(
  'signed, starts next month',
  partnerPaperStatus([{ signedAt: d('2026-09-15'), effectiveDate: d('2026-10-01'), expiryDate: null }], NOW),
  'not-yet-effective',
)
// The BEST row wins: a partner who re-signed keeps last year's lapsed copy
// on file, and that copy must not condemn them.
eq(
  'a lapsed copy beside a current one is covered',
  partnerPaperStatus(
    [
      { signedAt: d('2025-01-02'), effectiveDate: d('2025-01-01'), expiryDate: d('2025-12-31') },
      { signedAt: d('2026-01-02'), effectiveDate: d('2026-01-01'), expiryDate: d('2026-12-31') },
    ],
    NOW,
  ),
  'signed',
)
// ...and an UNSIGNED re-file must not condemn a partner whose current one
// is signed. The 2026-09-11 rule re-files the agreement for every partner
// whose copy predates the discount waterfall, so this row genuinely exists.
eq(
  'an unsigned re-file beside a signed one is covered',
  partnerPaperStatus(
    [
      { signedAt: null, effectiveDate: null, expiryDate: null },
      { signedAt: d('2026-09-01'), effectiveDate: null, expiryDate: null },
    ],
    NOW,
  ),
  'signed',
)

// ── What stops a booking ──────────────────────────────────────────────────
// ONLY "nothing signed" blocks. A lapsed agreement is named loudly and lets
// the booking through: somebody signed something, the relationship exists,
// and a renewal is not a reason to refuse a client's yes.
yes('nothing on file blocks', blocksBooking('none'))
yes('never signed blocks', blocksBooking('unsigned'))
yes('signed does not block', !blocksBooking('signed'))
yes('expired does not block', !blocksBooking('expired'))
yes('not-yet-effective does not block', !blocksBooking('not-yet-effective'))

// ── The operator's sentence ──────────────────────────────────────────────
const p = (over: Partial<UnpaperedPartner> = {}): UnpaperedPartner => ({
  vendorId: 'v1',
  vendorName: 'VSM Planet',
  unitNames: ['Profoto Pack & Head Kit — 2400 W/s'],
  status: 'unsigned',
  signedAt: null,
  expiryDate: null,
  ...over,
})

eq('a clean order says nothing', partnerPaperMessage([], []), null)
const msg = partnerPaperMessage([p()], [])!
yes('names the partner', msg.includes('VSM Planet'))
yes('names the unit — "a partner is unsigned" is not actionable', msg.includes('Profoto'))
yes('says what to do about it', msg.includes('/crm/portals#partners'))
yes('says why it matters', /§6 and §11|indemnity|testing/.test(msg))
const both = partnerPaperMessage([p()], [p({ vendorName: 'King Kong Trailers', status: 'expired', unitNames: [] })])!
yes('a lapsed partner is named too', both.includes('King Kong Trailers'))
yes('and says it lapsed rather than was never signed', both.includes('has expired'))
yes('a partner with no named unit still reads cleanly', !both.includes('()'))

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
