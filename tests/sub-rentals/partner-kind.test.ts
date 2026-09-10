/**
 * Equipment partners (PowerTrip Rentals, 2026-09-10) — the judgement calls,
 * asserted.
 *
 *   · partnerVocab / defaultReceiveMethodFor: an equipment partner's unit is
 *     DELIVERED unless the unit says otherwise; a vehicle partner's is driven.
 *   · groupPartnerUnits: a generator and a star wagon never share a section
 *     on /vehicles; sections come out in page order; a unit with no section
 *     falls into the vendor's default, never off the page.
 *   · vendorAgreementFor: EQUIPMENT files the Partner Equipment Agreement,
 *     whose clause 7 is delivery/setup, not drivers; VEHICLES is unchanged.
 *   · buildPartnerWelcome: the equipment welcome never asks for a driver and
 *     never says "vehicle"; the vehicle welcome still does.
 *
 * Run: npm run test:partner-kind
 */
import { partnerVocab, defaultReceiveMethodFor } from '@/lib/sub-rentals/partnerKind'
import { partnerSection, resolvePartnerSection, isPartnerSectionKey, PARTNER_SECTIONS } from '@/lib/site/partnerSections'
import { groupPartnerUnits, type PublicVehicle } from '@/lib/site/vehicleCatalog'
import { vendorAgreementFor } from '@/lib/contracts/vendorAgreementClauses'
import { buildPartnerWelcome } from '@/lib/sub-rentals/vendorInvite'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)
const no = (label: string, cond: boolean) => eq(label, cond, false)

// ── Vocabulary and receive method ───────────────────────────────────────────
eq('vehicle partner says vehicles', partnerVocab('VEHICLES').many, 'vehicles')
eq('equipment partner says equipment', partnerVocab('EQUIPMENT').many, 'equipment')
eq('unknown kind falls back to vehicles', partnerVocab(null).kind, 'VEHICLES')
eq('equipment unit with no override is delivered', defaultReceiveMethodFor({ defaultReceiveMethod: null }, { partnerKind: 'EQUIPMENT' }), 'DELIVERY')
eq('vehicle unit with no override is driven', defaultReceiveMethodFor({ defaultReceiveMethod: null }, { partnerKind: 'VEHICLES' }), 'PICKUP')
eq('unit override beats the vendor kind', defaultReceiveMethodFor({ defaultReceiveMethod: 'DELIVERY' }, { partnerKind: 'VEHICLES' }), 'DELIVERY')

// ── Sections ────────────────────────────────────────────────────────────────
eq('default section is motorhomes & trailers', partnerSection(null).key, 'LOCATION_VEHICLES')
eq('unknown key falls back, never throws', partnerSection('WIDGETS').key, 'LOCATION_VEHICLES')
yes('POWER_GENERATORS is a section', isPartnerSectionKey('POWER_GENERATORS'))
no('lowercase is not a section', isPartnerSectionKey('power_generators'))
eq('unit override beats vendor default', resolvePartnerSection({ catalogSection: 'LIFTS' }, { catalogSection: 'POWER_GENERATORS' }).key, 'LIFTS')
eq('vendor default when the unit has none', resolvePartnerSection({ catalogSection: null }, { catalogSection: 'POWER_GENERATORS' }).key, 'POWER_GENERATORS')
yes('every section has a distinct anchor', new Set(PARTNER_SECTIONS.map((s) => s.anchor)).size === PARTNER_SECTIONS.length)

const unit = (id: string, section: PublicVehicle['section'], partner = true): PublicVehicle => ({
  partner, section, id, name: id, slug: id, subtitle: null, tagline: null, description: null, features: [], dailyRate: null, photoUrl: null, photos: [],
  specs: { baseVehicle: null, model: null, fuelType: null, lengthFt: null, heightClearance: null, interiorBoxHeight: null, liftGateSpec: null },
})
const groups = groupPartnerUnits([unit('cube', null, false), unit('gen100', 'POWER_GENERATORS'), unit('starwagon', 'LOCATION_VEHICLES'), unit('scissor', 'LIFTS'), unit('gen60', 'POWER_GENERATORS')])
eq('owned fleet is not a partner group', groups.some((g) => g.items.some((i) => i.id === 'cube')), false)
eq('sections come out in page order', groups.map((g) => g.meta.key), ['LOCATION_VEHICLES', 'POWER_GENERATORS', 'LIFTS'])
eq('generators share one section', groups.find((g) => g.meta.key === 'POWER_GENERATORS')!.items.map((i) => i.id), ['gen100', 'gen60'])
eq('a partner unit with no section lands in the default group', groupPartnerUnits([unit('mystery', null)]).map((g) => g.meta.key), ['LOCATION_VEHICLES'])
eq('no partner units → no groups', groupPartnerUnits([unit('cube', null, false)]).length, 0)

// ── Agreement variant ───────────────────────────────────────────────────────
const veh = vendorAgreementFor('VEHICLES')
const eqp = vendorAgreementFor('EQUIPMENT')
eq('vehicles keeps its title', veh.title, 'Partner Vehicle Agreement')
eq('equipment gets its own title', eqp.title, 'Partner Equipment Agreement')
eq('null kind is the vehicle agreement', vendorAgreementFor(null).kind, 'VEHICLES')
eq('same clause count, same numbering', eqp.clauses.map((c) => c.ref), veh.clauses.map((c) => c.ref))
eq('vehicle clause 7 is Drivers', veh.clauses[6].title, 'Drivers')
eq('equipment clause 7 is delivery and setup', eqp.clauses[6].title, 'Delivery, Setup and Service')
no('equipment agreement never demands registration', eqp.clauses.some((c) => /registration/i.test(c.body)))
yes('equipment insurance is GL + inland marine, not auto-only', /inland-marine|inland marine/i.test(eqp.clauses[3].body) && /general liability/i.test(eqp.clauses[3].body))
yes('equipment terms name delivery, fuel and technician charges', /delivery, fuel and technician/.test(eqp.terms(20)[1].value))
eq('shared numbers agree: 24-hour cancellation on both', [/24 hours/.test(veh.clauses[1].body), /24 hours/.test(eqp.clauses[1].body)], [true, true])
eq('shared numbers agree: 30-day payment on both', [/30 days/.test(veh.clauses[7].body), /30 days/.test(eqp.clauses[7].body)], [true, true])

// ── Welcome email ───────────────────────────────────────────────────────────
const base = { vendorName: 'PowerTrip Rentals', contactName: 'Evan Crawford', accountUrl: 'https://hq.sirreel.com/vendor/account/x', unitCount: 13, agreementWaiting: true, senderName: 'Wes', sharePercent: 20 }
const eqMail = buildPartnerWelcome({ ...base, kind: 'EQUIPMENT' })
const vhMail = buildPartnerWelcome({ ...base, vendorName: 'King Kong Production Vehicles', contactName: 'David', kind: 'VEHICLES' })
no('equipment welcome never asks for a driver', /driver/i.test(eqMail.text))
no('equipment welcome never says vehicle', /vehicle/i.test(eqMail.text))
yes('equipment welcome asks for a delivery contact', /delivery contact/i.test(eqMail.text))
yes('equipment welcome names the Equipment Agreement', /Partner Equipment Agreement/.test(eqMail.text))
yes('equipment welcome states the deal on the rental rate', /20% of the rental rate/.test(eqMail.text))
yes('vehicle welcome still asks for drivers', /driver/i.test(vhMail.text))
yes('vehicle welcome still names the Vehicle Agreement', /Partner Vehicle Agreement/.test(vhMail.text))
yes('vehicle welcome states the deal on the vehicle rental rate', /20% of the vehicle rental rate/.test(vhMail.text))
yes('html and text agree on the agreement name', /Partner Equipment Agreement/.test(eqMail.html))
yes('default kind is the vehicle wording', /vehicle/i.test(buildPartnerWelcome(base).text))

console.log(fail === 0 ? '\nall good' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
