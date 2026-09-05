/**
 * The sub-rental conduit — the judgement calls, asserted.
 *
 *   · computeHours: the driver's day, including past-midnight wraps and the
 *     break. A partner invoices against this number.
 *   · isAckStale: "the driver confirmed" must go amber the moment the plan
 *     changes under them, and must NOT go amber when they simply haven't
 *     confirmed yet (different state, different copy).
 *   · receivesLogistics: an ESTIMATED unit's owner is never handed a
 *     production's address — nobody has committed.
 *   · The templates: what each side is allowed to see. The vendor and driver
 *     mails carry the address and call time (Wes 2026-09-05) and never a
 *     phone; the production mail names the driver and never the partner.
 *
 * Run: npm run test:conduit
 */
import { computePortalHours, isAckStale, parseClock, sumHours, workDateInWindow, hoursPromptOpen } from '@/lib/drivers/hoursEntry'
import {
  receivesLogistics,
  logisticsFor,
  buildLogisticsForVendor,
  buildLogisticsForDriver,
  buildDriverNamedForProduction,
  buildDriverAckForProduction,
} from '@/lib/sub-rentals/conduit'
import { isProfileComplete, driverDisplayName } from '@/lib/sub-rentals/vendorDrivers'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)
const no = (label: string, cond: boolean) => eq(label, cond, false)

// ── Hours — portal to portal ─────────────────────────────────────────────────
const h = (x: Parameters<typeof computePortalHours>[0]) => computePortalHours(x) as any
eq('lot 05:00 → wrap 19:30 = 14.5h, no break deducted', h({ leftLot: '05:00', onSet: '06:00', leftSet: '18:30', wrap: '19:30' }).hours, 14.5)
eq('lot 18:00 → wrap 02:00 crosses midnight = 8h', h({ leftLot: '18:00', wrap: '02:00' }).hours, 8)
yes('midnight crossing flagged', h({ leftLot: '18:00', wrap: '02:00' }).overnight)
eq('open day (no wrap) has null hours', h({ leftLot: '05:00', onSet: '06:00' }).hours, null)
eq('stamps are normalised to HH:MM', h({ leftLot: '5:00' }).startTime, '05:00')
no('left lot is required', computePortalHours({ leftLot: '' }).ok)
no('garbage stamp refused', computePortalHours({ leftLot: 'five' }).ok)
no('re-ordered stamps refused (left set before on set, no midnight)', computePortalHours({ leftLot: '05:00', onSet: '09:00', leftSet: '08:00', wrap: '10:00' }).ok)
no('a second midnight crossing refused', computePortalHours({ leftLot: '18:00', onSet: '02:00', leftSet: '01:00', wrap: '03:00' }).ok)
eq('skipped middle stamps still total', h({ leftLot: '06:00', wrap: '18:00' }).hours, 12)
eq('parseClock 23:59', parseClock('23:59'), 1439)
eq('parseClock 24:00 is null', parseClock('24:00'), null)
eq('sumHours skips open days and tolerates Decimal strings', sumHours([{ hours: '10.50' }, { hours: null }, { hours: 1.25 }]), 11.75)

// window: rental Sep 10–11, padded a day
const w = { startDate: '2026-09-10', endDate: '2026-09-11' }
yes('delivery the evening before is in window', workDateInWindow('2026-09-09', w))
yes('collection the morning after is in window', workDateInWindow('2026-09-12', w))
no('a week later is a typo', workDateInWindow('2026-09-19', w))
yes('no dates = open window', workDateInWindow('2026-01-01', { startDate: null, endDate: null }))
no('hours prompt closed before the job', hoursPromptOpen(w, '2026-09-08'))
yes('hours prompt open on day one', hoursPromptOpen(w, '2026-09-10'))
yes('hours prompt still open a week after', hoursPromptOpen(w, '2026-09-18'))
no('hours prompt closed a month after', hoursPromptOpen(w, '2026-10-15'))

// ── Ack staleness ────────────────────────────────────────────────────────────
no('never confirmed is NOT stale (it is "awaiting")', isAckStale(null, '2026-09-05T10:00:00Z'))
no('confirmed, nothing ever changed', isAckStale('2026-09-05T10:00:00Z', null))
no('confirmed after the last change', isAckStale('2026-09-05T11:00:00Z', '2026-09-05T10:00:00Z'))
yes('plan changed after they confirmed → stale', isAckStale('2026-09-05T10:00:00Z', '2026-09-05T11:00:00Z'))

// ── Who is told ──────────────────────────────────────────────────────────────
no('ESTIMATED owner is never handed an address', receivesLogistics('ESTIMATED'))
yes('REQUESTED owner is', receivesLogistics('REQUESTED'))
yes('CONFIRMED owner is', receivesLogistics('CONFIRMED'))
no('CANCELLED is over', receivesLogistics('CANCELLED'))

// ── What each side sees ──────────────────────────────────────────────────────
const job = {
  reportToAddress: '11801 Wentworth St, Sun Valley',
  reportToAccessNotes: 'North gate, code #4412',
  reportToTime: '6–7am',
  reportToContactName: 'Jamie',
  reportToUpdatedAt: new Date('2026-09-05T10:00:00Z'),
  pickupSameAsDelivery: true,
  pickupAddress: null,
  pickupAccessNotes: null,
  pickupTime: 'after wrap',
}
const l = logisticsFor({ callTime: '5:30 AM', driverNotes: 'Park along the east fence', logisticsUpdatedAt: new Date('2026-09-05T12:00:00Z'), job })
yes('logistics has the address', l.address === job.reportToAddress)
eq('pickup inherits the delivery address when same', l.pickupAddress, job.reportToAddress)
eq('pickup time is never inherited', l.pickupTime, 'after wrap')
eq('updatedAt is the later of job and unit', l.updatedAt, '2026-09-05T12:00:00.000Z')
no('logistics view carries no phone field', 'onSiteContactPhone' in (l as unknown as Record<string, unknown>) || 'contactPhone' in (l as unknown as Record<string, unknown>))

const vendorMail = buildLogisticsForVendor({
  vendorName: 'King Kong Production Vehicles', unitName: 'EcoFlux', startDate: '2026-09-11', endDate: '2026-09-11',
  reference: 'SR-JOB-0235', logistics: l, driverName: 'Sam Driver', vendorUrl: 'https://sirreel.com/vendor/x',
})
yes('vendor mail carries the address', vendorMail.text.includes(job.reportToAddress))
yes('vendor mail carries THIS unit\'s call time, not the general window', vendorMail.text.includes('5:30 AM') && !vendorMail.text.includes('6–7am'))
yes('vendor mail names the driver as already told', vendorMail.text.includes('Sam Driver has been sent the same'))
yes('vendor mail carries our job code as the reference', vendorMail.text.includes('SR-JOB-0235'))
yes('vendor mail routes questions to SirReel, not the production', vendorMail.text.includes('rather than contacting the production'))

const driverMail = buildLogisticsForDriver({
  driverName: 'Sam Driver', unitName: 'EcoFlux', startDate: '2026-09-11', endDate: '2026-09-11', logistics: l,
  driverUrl: 'https://tsx.sirreel.com/drive/unit/y', changed: true,
})
yes('driver mail says the plan CHANGED when re-sent', driverMail.subject.startsWith('Updated'))
yes('driver mail asks for confirmation', driverMail.text.includes('I have the location and call time'))
yes('driver mail includes who to ask for', driverMail.text.includes('Ask for: Jamie'))

const prodMail = buildDriverNamedForProduction({
  recipientName: 'Alexey Figurov', unitName: 'EcoFlux', startDate: '2026-09-11', endDate: '2026-09-11',
  driverName: 'Sam Driver', hasCallTime: false, portalUrl: 'https://tsx.sirreel.com/portal/job/slug',
})
yes('production mail names the driver', prodMail.subject.includes('Sam Driver'))
no('production mail never names the partner (no field for it)', /king kong/i.test(prodMail.html))
yes('production mail asks for the call time when none is set', prodMail.text.includes('Add the call time'))
yes('production mail greets by first name', prodMail.text.startsWith('Alexey —'))

const ackMail = buildDriverAckForProduction({
  recipientName: null, unitName: 'EcoFlux', startDate: '2026-09-11', endDate: '2026-09-11',
  driverName: 'Sam Driver', logistics: l, note: 'Will arrive 15 early', portalUrl: 'https://x',
})
yes('ack mail carries the driver\'s note', ackMail.text.includes('From Sam Driver: Will arrive 15 early'))
yes('ack mail restates what was confirmed', ackMail.text.includes('Call time: 5:30 AM'))

// ── Roster profile completeness ──────────────────────────────────────────────
const full = { firstName: 'Sam', phone: '818', licenseFrontUrl: 'u', licenseBackUrl: 'u' }
yes('name + phone + both licence sides = complete', isProfileComplete(full))
no('missing back of licence = incomplete', isProfileComplete({ ...full, licenseBackUrl: null }))
no('missing phone = incomplete', isProfileComplete({ ...full, phone: '  ' }))
no('missing first name = incomplete', isProfileComplete({ ...full, firstName: null }))
eq('display name falls back to the email', driverDisplayName({ firstName: null, lastName: null, email: 'sam@kk.com' }), 'sam@kk.com')
eq('display name joins first + last', driverDisplayName({ firstName: 'Sam', lastName: 'Driver', email: 'x' }), 'Sam Driver')

console.log(fail ? `\n${fail} FAILED` : '\nall ok')
process.exit(fail ? 1 : 0)
