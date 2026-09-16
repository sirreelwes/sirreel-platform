/**
 * Borrowed gear on the pull sheet (2026-09-16 — Wes).
 *
 * "If they are delivered, they should be on the Pick List but in a different
 * section (Partner). How do we handle this with sub leased equipment? It
 * should be the same as that but under a different heading. Both subbed and
 * partner equipment have to be returned to their host warehouse."
 *
 * Asserted:
 *   · a roster unit → Partner, an ad-hoc sub-lease → Sub-Rental, our own
 *     gear → its department as before;
 *   · both name the house they go back to — the whole reason for the
 *     headings, since a sub-leased fixture that came back unlabelled used to
 *     end up on our shelf looking like ours;
 *   · borrowed sections sort ABOVE the departments, and every department
 *     still has a slot (the PHOTO_SHOOT bug, guarded again from this side);
 *   · DELIVER_TO_SIRREEL is the ONE receive method that puts a partner line
 *     back on the sheet — and `PARTNER_SUB_RENTAL_WHERE` and the renderer's
 *     JS twin agree about that, which is the thing most likely to drift
 *     because Prisma cannot select one relation twice.
 *
 * Run: npm run test:pick-sections
 */
import {
  pickSectionFor, returnToLabel, PICK_GROUP_ORDER, PICK_SECTION_LABEL,
  pickGroupLabel, isPickSection,
} from '@/lib/warehouse/pickSections'
import { PARTNER_SUB_RENTAL_WHERE } from '@/lib/orders/partnerLines'
import { LINE_ITEM_DEPARTMENT_ORDER } from '@/lib/orders/lineItemDepartments'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)

const roster = { subcontractedVehicleId: 'sv_1', vendorName: 'VSM Planet Rentals' }
const adhoc = { subcontractedVehicleId: null, vendorName: 'Cinelease' }

// ── which heading ─────────────────────────────────────────────────────
eq('our own gear has no section', pickSectionFor({ subRentals: [] }), null)
eq('a roster unit is Partner', pickSectionFor({ subRentals: [roster] }), 'PARTNER')
eq('an ad-hoc sub-lease is Sub-Rental', pickSectionFor({ subRentals: [adhoc] }), 'SUB_RENTAL')
// A roster unit is the more specific fact — it has a portal, an agreement
// and a deal behind it.
eq('both on one line reads Partner', pickSectionFor({ subRentals: [adhoc, roster] }), 'PARTNER')

// ── where it goes back ────────────────────────────────────────────────
eq('our own gear has no return', returnToLabel({ subRentals: [] }), null)
eq('partner return names the house', returnToLabel({ subRentals: [roster] }), 'Back to VSM Planet Rentals')
eq('sub-lease return names the house', returnToLabel({ subRentals: [adhoc] }), 'Back to Cinelease')
eq('two houses, both named', returnToLabel({ subRentals: [roster, adhoc] }), 'Back to VSM Planet Rentals · Cinelease')
eq('the same house is not named twice', returnToLabel({ subRentals: [roster, { ...roster }] }), 'Back to VSM Planet Rentals')
eq('an unnamed vendor is skipped, not printed blank', returnToLabel({ subRentals: [{ subcontractedVehicleId: 'x', vendorName: null }] }), null)

// ── order on the sheet ────────────────────────────────────────────────
eq('Partner is first', PICK_GROUP_ORDER[0], 'PARTNER')
eq('Sub-Rental is second', PICK_GROUP_ORDER[1], 'SUB_RENTAL')
for (const d of LINE_ITEM_DEPARTMENT_ORDER) {
  yes(`${d} still has a slot`, (PICK_GROUP_ORDER as string[]).includes(d))
}
eq('no duplicate keys', new Set(PICK_GROUP_ORDER).size, PICK_GROUP_ORDER.length)
eq('section labels', PICK_SECTION_LABEL, { PARTNER: 'Partner', SUB_RENTAL: 'Sub-Rental' })
eq('a section labels itself', pickGroupLabel('PARTNER', () => 'nope'), 'Partner')
eq('a department defers to the department labeller', pickGroupLabel('GE', (k) => `dept:${k}`), 'dept:GE')
yes('isPickSection knows the two', isPickSection('PARTNER') && isPickSection('SUB_RENTAL'))
yes('a department is not a section', !isPickSection('GE'))

// ── the two halves of "stays off the pick list" agree ─────────────────
// PARTNER_SUB_RENTAL_WHERE is what the query excludes; withPartnerSubs in
// renderPickListPdf is the same predicate in JS, because the sheet now loads
// every live sub-rental. If one gains a condition the other has to.
const where = PARTNER_SUB_RENTAL_WHERE as Record<string, unknown>
eq('the where still keys on a roster unit', where.subcontractedVehicleId, { not: null })
eq('the where still skips cancelled', where.status, { not: 'CANCELLED' })
eq('the where now lets delivered-to-us gear through', where.NOT, { receiveMethod: 'DELIVER_TO_SIRREEL' })

/** The renderer's JS twin, restated — kept identical on purpose. */
const staysOffTheSheet = (sr: { subcontractedVehicleId: string | null; receiveMethod: string | null }) =>
  sr.subcontractedVehicleId != null && sr.receiveMethod !== 'DELIVER_TO_SIRREEL'

yes('a partner unit driven to set stays off', staysOffTheSheet({ subcontractedVehicleId: 'sv_1', receiveMethod: 'DELIVERY' }))
yes('a will-call partner unit stays off', staysOffTheSheet({ subcontractedVehicleId: 'sv_1', receiveMethod: 'WILL_CALL' }))
yes('a partner unit DELIVERED TO US is on the sheet', !staysOffTheSheet({ subcontractedVehicleId: 'sv_1', receiveMethod: 'DELIVER_TO_SIRREEL' }))
yes('an ad-hoc sub-lease was always on the sheet', !staysOffTheSheet({ subcontractedVehicleId: null, receiveMethod: 'PICKUP' }))

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
