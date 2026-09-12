/**
 * Reading an EMAIL as a reservation request.
 *
 *   npx tsx tests/sales/email-vehicle-match.test.ts
 *   npm run test:email-vehicle
 *
 * Pure + offline. The category fixture is the live fleet's names and
 * aliases as of 2026-09-11, because the weighting is computed FROM that
 * list — a matcher tested against three invented rows proves nothing
 * about the shared words in the real one ("van" is in five of them).
 *
 * Both failure directions have a cost and both are guarded:
 *
 *   TOO STRICT is what shipped. "VTR Van - Sept 29-Oct 1 - SW Visual
 *   Holdings" arrived with vehicleType "VTR Van" extracted at 0.95 and
 *   the card offered nothing but Capture & Quote, because the reserve
 *   branch only ever read a web-form cart.
 *
 *   TOO LOOSE preloads a HOLD on the wrong truck. "van" alone is a
 *   curated alias of Cargo Van w/o Liftgate; if a bare "van" in a body
 *   resolved, every email mentioning one would reserve a cargo van.
 */

import {
  matchVehicleCategory,
  readEmailVehicleRequest,
  MIN_EXTRACTION_CONFIDENCE,
  type MatchableCategory,
} from '../../src/lib/sales/emailVehicleMatch'

const failures: string[] = []

/** The live gantt-reservable fleet, names + seeded aliases. */
const FLEET: MatchableCategory[] = [
  { id: 'proscout', name: 'ProScout / VideoVan', aliases: ['proscout', 'pro scout', 'vtr', 'video village'] },
  { id: 'cube', name: 'SuperCube Truck', aliases: ['cube', 'cubes', 'cube truck', 'cube trucks'] },
  { id: 'camcube', name: 'Camera Cube', aliases: ['camera cube', 'camera truck', 'cam cube'] },
  { id: 'cargo-lg', name: 'Cargo Van w/ Liftgate', aliases: ['cargo van with liftgate', 'liftgate van', 'lift van'] },
  { id: 'cargo', name: 'Cargo Van w/o Liftgate', aliases: ['cargo van', 'cargo vans', 'van', 'cargo van no lift'] },
  { id: 'pass', name: 'Passenger Van', aliases: ['passenger van', 'pass van', 'pax van', '15 passenger van', '15-passenger van', '15 pass van', '12 passenger van', '12-passenger van', '12 pass van', 'nissan nv'] },
  { id: 'pop', name: 'PopVan', aliases: ['popvan', 'pop van', 'pop-van'] },
  { id: 'stage', name: 'Lankershim Studios', aliases: ['stage', 'stages', 'soundstage', 'studio', 'sound stage'] },
  { id: 'dlux', name: '2 Unit Restroom Trailer', aliases: [] },
  { id: 'lift', name: 'Scissor Lift', aliases: ['scissor lift', 'lift', 'scissorlift'] },
  { id: 'retired', name: '12-Passenger Van (retired — merged back into Passenger Van)', aliases: [] },
]

function hits(query: string, expectedId: string, why: string): void {
  const m = matchVehicleCategory(query, FLEET)
  if (m?.fleetCategoryId === expectedId) console.log(`  ok — ${why}`)
  else failures.push(`"${query}" should resolve to ${expectedId}, got ${m ? `${m.fleetCategoryId} (${m.score.toFixed(2)})` : 'null'} — ${why}`)
}

function misses(query: string, why: string): void {
  const m = matchVehicleCategory(query, FLEET)
  if (!m) console.log(`  ok — ${why}`)
  else failures.push(`"${query}" should resolve to NOTHING, got ${m.fleetCategoryId} (${m.score.toFixed(2)}) — ${why}`)
}

console.log('\nThe vehicle a client named\n')

hits('VTR Van', 'proscout', 'the founding case — subject line of the 9/11 inquiry')
hits('vtr van', 'proscout', 'case is not a signal')
hits('Pro Scout / Video Van', 'proscout', "Gabe Figueroa's phrasing, 8/31")
hits('ProScout Video Van', 'proscout', 'run together, no punctuation')
hits('VTR/Video Van', 'proscout', 'slashes are separators, not letters')
hits('video village van', 'proscout', 'the alias for what crews call the room')

hits('cube truck', 'cube', 'the plain cube beats the camera cube on its own phrase')
hits('2 cube trucks', 'cube', 'plural + a count the matcher ignores')
hits('camera cube', 'camcube', 'and the camera cube wins its own')
hits('cargo van', 'cargo', 'a bare cargo van is the no-liftgate one (seed ruling)')
hits('cargo van with liftgate', 'cargo-lg', 'saying liftgate moves it')
hits('15 passenger van', 'pass', 'a spelled-out passenger van')
hits('12 passenger van', 'pass', 'the retired merged-away row never wins its own tokens back')
hits('popvan', 'pop', 'one word')
hits('pop van', 'pop', 'two words')
hits('scissor lift', 'lift', 'not a vehicle in the van sense, still holdable')
hits('stage', 'stage', 'stages take holds too')

console.log('\nText that names no ONE thing resolves to nothing\n')

misses('van', 'the bare word half the fleet answers to — Wes\'s "van is in the email" is VTR Van, not this')
misses('a van', 'ditto with an article')
misses('truck', 'shared between the cube and the camera cube')
misses('vehicle', 'says nothing at all')
misses('sprinter van', 'a make we do not rent — the van alone must not carry it')
misses('', 'empty string is a miss, never a throw')
misses('   ', 'whitespace likewise')

console.log('\nThe extraction gate\n')

const LUKE = {
  company: 'SW Visual Holdings',
  contact: { name: 'Luke Gilbert', email: 'luke.gilbert33@gmail.com', phone: '+1 973-615-1804' },
  jobIntent: {
    vehicleType: 'VTR Van',
    pickupDate: '2026-09-29',
    returnDate: '2026-10-01',
    projectName: 'Biker',
  },
}
const TODAY = '2026-09-11'

const luke = readEmailVehicleRequest(LUKE, 0.95, FLEET, TODAY)
if (luke?.vehicles[0]?.fleetCategoryId === 'proscout'
  && luke.start === '2026-09-29' && luke.end === '2026-10-01'
  && luke.jobName === 'Biker' && luke.companyName === 'SW Visual Holdings'
  && luke.contact?.firstName === 'Luke' && luke.contact.lastName === 'Gilbert'
  && luke.contact.phone === '+1 973-615-1804'
  && luke.requestedAs === 'VTR Van') {
  console.log('  ok — the 9/11 inquiry reads end to end: truck, window, job, company, contact')
} else {
  failures.push(`the live inquiry did not read back: ${JSON.stringify(luke)}`)
}

function nulls(extracted: unknown, conf: number | null, why: string): void {
  if (readEmailVehicleRequest(extracted, conf, FLEET, TODAY) === null) console.log(`  ok — ${why}`)
  else failures.push(`should NOT offer a reservation: ${why}`)
}

nulls(LUKE, 0.7, `confidence under ${MIN_EXTRACTION_CONFIDENCE} is a human's call`)
nulls(LUKE, 0, 'zero confidence is the extractor-failed fallback shape')
nulls(LUKE, null, 'a row that never ran extraction')
nulls({ ...LUKE, jobIntent: { ...LUKE.jobIntent, vehicleType: null } }, 0.95, 'no vehicle named')
nulls({ ...LUKE, jobIntent: { ...LUKE.jobIntent, vehicleType: 'van' } }, 0.95, 'a vehicle named too vaguely to hold')
nulls({ ...LUKE, jobIntent: null }, 0.95, 'no jobIntent at all')
nulls(null, 0.95, 'null extraction')
nulls('not an object', 0.95, 'a string where the blob should be')
nulls({}, 0.95, 'an empty blob')

console.log('\nWhat the live inbox actually sends (checked 2026-09-11)\n')

function reads(vehicleType: string, expect: Array<[string, number]>, why: string): void {
  const r = readEmailVehicleRequest({ ...LUKE, jobIntent: { ...LUKE.jobIntent, vehicleType } }, 0.95, FLEET, TODAY)
  const got = (r?.vehicles ?? []).map((v) => [v.fleetCategoryId, v.quantity] as [string, number])
  const same = got.length === expect.length
    && expect.every(([id, q], i) => got[i][0] === id && got[i][1] === q)
  if (same) console.log(`  ok — ${why}`)
  else failures.push(`"${vehicleType}" should read ${JSON.stringify(expect)}, got ${JSON.stringify(got)} — ${why}`)
}

// Over-matches caught against the real inbound queue before this shipped.
reads('2 ton sprinter or 3 ton box truck', [],
  'a bare numeral must not match the 2 UNIT Restroom Trailer on the digit "2"')
reads('5-ton box truck with lift gate', [],
  '"with" must not carry a box truck onto Cargo Van w/ Liftgate — we have no 5-ton')
reads('a cube or a cargo van', [],
  'alternatives are the desk\'s choice, not both holds and not a coin flip')
reads('high roof passenger van', [['pass', 1]], 'a qualifier we do not stock is still a passenger van')
reads('liftgate van', [['cargo-lg', 1]], 'the liftgate alias on its own')
reads('production pop van', [['pop', 1]], 'an adjective in front of a PopVan')

// Multi-vehicle asks.
reads('15 pass van, cargo van, 12 pass van', [['pass', 2], ['cargo', 1]],
  'three asks fold to two lines — the modal refuses two lines of one category')
reads('cube truck and a passenger van', [['cube', 1], ['pass', 1]], '"and" is two things')
reads('2 cube trucks + a camera cube', [['cube', 1], ['camcube', 1]],
  '"+" likewise; the count in the text is not the quantity')

console.log('\nDates\n')

function window_(intent: Record<string, unknown>, start: string | null, end: string | null, why: string): void {
  const r = readEmailVehicleRequest({ ...LUKE, jobIntent: { ...LUKE.jobIntent, ...intent } }, 0.95, FLEET, TODAY)
  if (r && r.start === start && r.end === end) console.log(`  ok — ${why}`)
  else failures.push(`window should be ${start}…${end}, got ${r?.start}…${r?.end} — ${why}`)
}

window_({ returnDate: null }, '2026-09-29', '2026-09-29', 'a one-day ask ends the day it starts')
window_({ pickupDate: null, returnDate: null }, null, null, 'no dates at all still offers the truck')
window_({ pickupDate: '2025-09-29', returnDate: '2025-10-01' }, '2026-09-29', '2026-10-01',
  'a model-supplied wrong YEAR rolls forward, same as the quote parser')
window_({ returnDate: '2026-09-20' }, '2026-09-29', '2026-09-29', 'an end before the start is a misread, not a backwards window')

console.log('\nDegenerate categories\n')

if (matchVehicleCategory('VTR Van', []) === null) console.log('  ok — no categories is a miss, never a throw')
else failures.push('an empty category list should never match')

if (matchVehicleCategory('12 passenger van', [FLEET[10]]) === null) {
  console.log('  ok — a retired row cannot win even when it is the only row')
} else failures.push('a retired category must never be a reservation target')

console.log('')
if (failures.length) {
  console.error(`${failures.length} failure(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All email-vehicle-match checks passed.')
