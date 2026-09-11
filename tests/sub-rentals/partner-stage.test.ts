/**
 * The partner stage (Wes 2026-09-11: "no company gets onboarded until they
 * reply and I mark it as a new partner") — the one rule, asserted:
 *
 *   · a bare Vendor row is a vendor, not a prospect (Amazon stays out);
 *   · a queued row is a prospect; the introduction makes it introduced;
 *     only the mark makes it a partner;
 *   · a partner from before the mark (roster units, bookings or an
 *     agreement) reads as a partner without one;
 *   · the mark wins over everything, and the introduction alone never
 *     reaches partner.
 *
 * Run: npm run test:partner-stage
 */
import { partnerStage, STAGE_LABEL } from '@/lib/sub-rentals/partnerStage'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

const none = { partnerProspectAt: null, welcomeSentAt: null, partnerMarkedAt: null, legacyPartner: false }
const t = new Date('2026-09-11T15:00:00Z')

eq('bare vendor row is a vendor', partnerStage(none), 'vendor')
eq('queued row is a prospect', partnerStage({ ...none, partnerProspectAt: t }), 'prospect')
eq('introduction sent → introduced', partnerStage({ ...none, partnerProspectAt: t, welcomeSentAt: t }), 'introduced')
eq('introduction alone never reaches partner', partnerStage({ ...none, welcomeSentAt: t }), 'introduced')
eq('the mark makes a partner', partnerStage({ ...none, partnerProspectAt: t, welcomeSentAt: t, partnerMarkedAt: t }), 'partner')
eq('legacy partner (roster / bookings / agreement) reads as partner', partnerStage({ ...none, legacyPartner: true }), 'partner')
eq('legacy partner with an introduction is still a partner', partnerStage({ ...none, legacyPartner: true, welcomeSentAt: t }), 'partner')
eq('ISO strings count the same as dates', partnerStage({ ...none, partnerMarkedAt: t.toISOString() }), 'partner')
eq('every stage has a label', Object.keys(STAGE_LABEL).sort(), ['introduced', 'partner', 'prospect', 'vendor'])

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
