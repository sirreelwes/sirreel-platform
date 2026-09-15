/**
 * Texting a partner about a booking — their choice, and the conduit still holds.
 *
 *   npm run test:partner-sms
 *
 * Wes 2026-09-15 (California Rent A Car): "how they could choose to get
 * notified by text?" Pinned, with Prisma and the sender stubbed:
 *   - the words carry the unit, the dates and their booking link, and NEVER a
 *     production, a company, an address or a rate
 *   - only contacts who ticked it, with a number, are texted
 *   - a booking with no partner page texts nobody
 *   - a failed or skipped send is reported, never thrown
 *   - cleanContactInput refuses the tick without a mobile, and stamps consent
 */
import Module from 'module'

const sent: Array<{ to: string; body: string; source: string }> = []
let contacts: Array<{ name: string; phone: string | null }> = []
let row: Record<string, unknown> | null = null
let sendResult = { ok: true, status: 'queued' }

const origLoad = (Module as never as { _load: (...a: unknown[]) => unknown })._load
;(Module as never as { _load: unknown })._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req.endsWith('/lib/prisma') || req === '@/lib/prisma') {
    return { prisma: { subRental: { findUnique: async () => (row ? { ...row, vendor: { id: 'v1', contacts } } : null) } } }
  }
  if (req.endsWith('/sms/threads') || req === '@/lib/sms/threads') {
    return {
      sendTracked: async (a: { to: string; body: string; source: string }) => { sent.push(a); return sendResult },
      recordConsent: async () => true,
    }
  }
  return (origLoad as (...a: unknown[]) => unknown).apply(this, [req, parent, isMain])
}

let failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
}

const base = {
  id: 's1', itemDescription: 'Chevy Suburban', startDate: new Date('2026-09-22T00:00:00Z'), endDate: new Date('2026-09-24T00:00:00Z'),
  vendorToken: 'tok123', subcontractedVehicle: { name: 'Chevy Suburban' },
}

async function main() {
  const { buildPartnerSms, textPartnerAboutBooking } = await import('../../src/lib/sub-rentals/partnerSms')
  const { cleanContactInput } = await import('../../src/lib/sub-rentals/vendorContacts')

  console.log('the words')
  const args = { vehicleName: 'Chevy Suburban', startDate: '2026-09-22', endDate: '2026-09-24', url: 'https://sirreel.com/vendor/tok123' }
  const all = (['estimate', 'hold', 'go', 'released'] as const).map((k) => buildPartnerSms(k, args))
  check('every text names the unit, the dates and the link', all.every((t) => t.includes('Chevy Suburban') && t.includes('Sep 22-Sep 24') && t.includes('https://sirreel.com/vendor/tok123')), all)
  check('the hold asks them to confirm', /please hold these dates/i.test(all[1]) && /confirm/i.test(all[1]))
  check('the go says booked; the release gives the dates back', /it's a go/i.test(all[2]) && /yours again/i.test(all[3]))
  check('no production, company, address or money anywhere', all.every((t) => !/production[’']s|Inc\.|LLC|\$|Blvd|Ave |St,/.test(t)), all)
  check('a one-day booking reads as one day', buildPartnerSms('hold', { ...args, endDate: '2026-09-22' }).includes('Sep 22.'))

  console.log('\nwho gets it')
  row = { ...base }
  contacts = [{ name: 'Clifford', phone: '917-575-6905' }, { name: 'Desk', phone: '310-477-2727' }]
  sent.length = 0
  let r = await textPartnerAboutBooking('s1', 'hold')
  check('everyone who opted in is texted once', r.sent === 2 && sent.length === 2, { r, sent: sent.map((s) => s.to) })
  check('sent as an automated message (quiet hours + STOP apply in sendTracked)', sent.every((s) => s.source === 'system'))

  contacts = []
  sent.length = 0
  r = await textPartnerAboutBooking('s1', 'hold')
  check('nobody opted in → no texts', r.sent === 0 && sent.length === 0)

  row = { ...base, vendorToken: null }
  contacts = [{ name: 'Clifford', phone: '917-575-6905' }]
  sent.length = 0
  r = await textPartnerAboutBooking('s1', 'hold')
  check('no booking page → no text (the link is the point)', r.sent === 0 && sent.length === 0)

  row = { ...base }
  sendResult = { ok: false, status: 'skipped-opted-out' }
  sent.length = 0
  r = await textPartnerAboutBooking('s1', 'go')
  check('an opted-out number is reported, not thrown', r.sent === 0 && r.skipped[0] === 'Clifford: skipped-opted-out', r)

  console.log('\nconsent')
  const noPhone = cleanContactInput({ name: 'X', email: 'x@y.com', smsBookings: true })
  check('no mobile, no tick', !noPhone.ok && /mobile number/.test(noPhone.error))
  const withPhone = cleanContactInput({ name: 'X', email: 'x@y.com', phone: '917-555-0100', smsBookings: true })
  check('with a mobile it sticks', withPhone.ok && withPhone.value.smsBookings)
  check('off by default', cleanContactInput({ name: 'X', email: 'x@y.com', phone: '917-555-0100' }).ok && !(cleanContactInput({ name: 'X', email: 'x@y.com', phone: '917-555-0100' }) as { value: { smsBookings: boolean } }).value.smsBookings)

  if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
  console.log('\nall passing')
}
void main()
