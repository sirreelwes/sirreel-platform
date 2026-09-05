/**
 * The one piece of judgement on the job page's sub-rental panel: which rows
 * are shouting.
 *
 * `isUnaskedHold` decides whether a row turns red and grows a "Send hold
 * request" button. It exists because the approval hook keeps the client's yes
 * durable even when the notice fails to send — so a row can read REQUESTED
 * while its owner still believes the unit is free, and nothing else on the
 * page would say so.
 *
 * Both failure directions cost something real, which is why both are asserted
 * here. A FALSE NEGATIVE is the expensive one: the partner is never chased and
 * re-rents the coach out from under a committed client. A FALSE POSITIVE cries
 * wolf on an ESTIMATED row — where nobody has accepted and the partner is
 * CORRECTLY un-asked — and an operator who learns to ignore this banner is
 * back to the silent failure it was built to end.
 *
 * Run: npm run test:sub-rental-hold
 */
import { isUnaskedHold, type JobSubRental } from '@/components/jobs/JobSubRentalsSection'
import { isClientCommittedOrder } from '@/lib/sub-rentals/commitment'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${got}${ok ? '' : ` (want ${want})`}`)
}

const row = (status: string, vendorHoldRequestedAt: string | null, clientCommitted = false): JobSubRental => ({
  id: 'x', status, vehicleName: 'EcoFlux', quantity: 1, clientCommitted,
  startDate: '2026-09-10', endDate: '2026-09-11',
  receiveMethod: null, poNumber: null,
  vendorNotifiedAt: '2026-08-28T00:00:00.000Z', vendorHoldRequestedAt,
  driverName: null, driverPhone: null, driverEmail: null, relayAddress: null,
  vendorUrl: null, vendorTotal: null, clientTotal: null,
  vendor: { id: 'v', name: 'King Kong', email: 'd@k.com', poEmail: null, phone: null },
  order: null, orderLineItem: null,
})

// ── The whole point: committed, but the notice never left ──────────────
eq('REQUESTED + never asked → alarm', isUnaskedHold(row('REQUESTED', null)), true)
eq('CONFIRMED + never asked → alarm', isUnaskedHold(row('CONFIRMED', null)), true)
eq('PICKED_UP + never asked → alarm', isUnaskedHold(row('PICKED_UP', null)), true)
eq('ON_RENT + never asked → alarm', isUnaskedHold(row('ON_RENT', null)), true)

// ── Asked. Quiet. ──────────────────────────────────────────────────────
eq('REQUESTED + asked → quiet', isUnaskedHold(row('REQUESTED', '2026-08-29T00:00:00.000Z')), false)
eq('ON_RENT + asked → quiet', isUnaskedHold(row('ON_RENT', '2026-08-29T00:00:00.000Z')), false)

// ── Crying wolf. ESTIMATED means the client has NOT accepted, so an
//    un-asked partner is the correct state, not a failure. This is the
//    live shape of the EcoFlux row on SR-JOB-0235 right now.
eq('ESTIMATED + never asked → quiet (nobody accepted)', isUnaskedHold(row('ESTIMATED', null)), false)

// ── The HQ-side yes (2026-09-05). The client approved or booked through HQ,
//    not the portal, so the row never left ESTIMATED and the partner's last
//    notice from us says "this is NOT a booking". The row's own status can't
//    see it; the order can. This is the FIGUROV shape.
eq('ESTIMATED + order committed + never asked → alarm', isUnaskedHold(row('ESTIMATED', null, true)), true)
eq('ESTIMATED + order committed + asked → quiet', isUnaskedHold(row('ESTIMATED', '2026-09-05T00:00:00.000Z', true)), false)
eq('ESTIMATED + order NOT committed → quiet', isUnaskedHold(row('ESTIMATED', null, false)), false)

// ── Which order statuses count as the client's yes. ────────────────────
for (const st of ['APPROVED', 'BOOKED', 'LOADED_READY', 'ON_JOB']) {
  eq(`order ${st} → committed`, isClientCommittedOrder(st), true)
}
// Not yet a yes — and the post-rental tail, where a hold is moot and a stale
// ESTIMATED row must not shout (or mail "please hold" for past dates).
for (const st of ['DRAFT', 'QUOTE_SENT', 'CANCELLED', 'RETURNED', 'LD_CHECK', 'INVOICED', 'CLOSED', null, undefined, '']) {
  eq(`order ${String(st)} → not committed`, isClientCommittedOrder(st), false)
}

// ── Terminal rows never shout: there is nothing left to hold. ──────────
eq('RETURNED + never asked → quiet', isUnaskedHold(row('RETURNED', null)), false)
eq('CANCELLED + never asked → quiet', isUnaskedHold(row('CANCELLED', null)), false)

console.log(fail === 0 ? '\nAll hold-state checks passed.' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
