/**
 * A desk card charge on an HQ invoice counts once on the collections desk.
 *
 * Found 2026-09-15: MITU NGL, LLC, SR-INV-30022, $360, charged from the desk
 * on 9/14 (and Creative Riff SR-INV-30015, $1,504, on 9/11).
 * /api/collections/charge wrote the `RwCollectionCharge` (anchored
 * `hq:<invoiceId>`) and then a `Payment` on the invoice with the same retref,
 * and buildDeskActivity summed both — card bucket AND hq bucket — so the desk
 * read $720. The charge stays; the Payment echoing it is dropped.
 *
 * Run: npm run test:desk-charge-payments
 */
import {
  chargeCountsAsCollected,
  paymentsEchoingDeskCharges,
  type DeskChargeLike,
  type DeskPaymentLike,
} from '../../src/lib/collections/deskChargePayments'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

const INV = 'e8a9d39f-0000-4000-8000-000000000001'
const charge = (over: Partial<DeskChargeLike> = {}): DeskChargeLike => ({
  rwInvoiceId: `hq:${INV}`,
  retref: '123456789012',
  status: 'APPROVED',
  reversedAt: null,
  ...over,
})
const payment = (id: string, over: Partial<DeskPaymentLike> = {}): DeskPaymentLike => ({
  id,
  invoiceId: INV,
  gatewayRefId: '123456789012',
  ...over,
})
const echoed = (c: DeskChargeLike[], p: DeskPaymentLike[]) => [...paymentsEchoingDeskCharges(c, p)].sort()

// The MITU case: one charge, its Payment 121ms later — the Payment is the echo.
eq('hq: charge hides its own Payment', echoed([charge()], [payment('p1')]), ['p1'])

// The desk's money total, the way buildDeskActivity adds it.
{
  const charges = [charge()]
  const payments = [payment('p1')]
  const hidden = paymentsEchoingDeskCharges(charges, payments)
  const card = charges.filter(chargeCountsAsCollected).length * 360
  const hq = payments.filter((p) => !hidden.has(p.id)).length * 360
  eq('MITU $360 totals $360, not $720', card + hq, 360)
}

// Payments that are NOT the echo stay.
eq('manual Zelle on the same invoice (no retref) stays', echoed([charge()], [payment('p2', { gatewayRefId: null })]), [])
eq('portal card payment on the same invoice, other retref, stays',
  echoed([charge()], [payment('p3', { gatewayRefId: '999999999999' })]), [])
eq('same retref on a different invoice stays',
  echoed([charge()], [payment('p4', { invoiceId: 'another-invoice' })]), [])
eq('RentalWorks charge never hides a Payment',
  echoed([charge({ rwInvoiceId: INV })], [payment('p5')]), [])
eq('final: charge never hides a Payment',
  echoed([charge({ rwInvoiceId: `final:${INV}` })], [payment('p6')]), [])

// The charge only hides its echo while the charge itself is counted.
eq('declined charge hides nothing', echoed([charge({ status: 'DECLINED' })], [payment('p7')]), [])
eq('retref-less charge hides nothing', echoed([charge({ retref: null })], [payment('p8', { gatewayRefId: null })]), [])
// Partial refund: reversedAt is stamped, the card bucket drops the charge, and
// the replacement Payment (same retref, the kept base) is the only place the
// money the invoice kept can show — so it must survive.
eq('partially refunded charge leaves the replacement Payment counted',
  echoed([charge({ reversedAt: new Date('2026-09-15T20:00:00Z') })], [payment('p9')]), [])

eq('approved, un-reversed counts', chargeCountsAsCollected(charge()), true)
eq('reversed does not count', chargeCountsAsCollected(charge({ reversedAt: new Date() })), false)
eq('error does not count', chargeCountsAsCollected(charge({ status: 'ERROR' })), false)

if (fail) {
  console.error(`\n${fail} failing`)
  process.exit(1)
}
console.log('\nall passing')
