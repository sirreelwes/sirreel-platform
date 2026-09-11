/**
 * After-hours vehicle pickup email.
 *
 *   npm run test:vehicle-pickup
 *
 * Wes 2026-09-10: "an easy button for sales to send this summary" — the
 * After Hours Instructions email Jose types by hand (address, Gate 1 +
 * code, the press-slowly line, the drivers-license reminder, then
 * Vehicle / License Plate / Vehicle Lock Box Code). These pin that every
 * fact lands in both halves, that a second vehicle gets its own block,
 * and that the two dead www.sirreel.com links never come back.
 */
import { buildVehiclePickupEmail, vehicleListPhrase } from '../../src/lib/email/templates/vehiclePickup'

let failed = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`)
  else { failed++; console.log(`  ✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

console.log('vehicleListPhrase')
check('none → generic', vehicleListPhrase([]) === 'your vehicle')
check('one', vehicleListPhrase(['Pass #9']) === 'Pass #9')
check('two', vehicleListPhrase(['Pass #9', 'Cube 27']) === 'Pass #9 and Cube 27')
check('three', vehicleListPhrase(['Pass #9', 'Cube 27', 'Cube 28']) === 'Pass #9, Cube 27 and Cube 28')

console.log('buildVehiclePickupEmail — the summary as Jose sends it')
const one = buildVehiclePickupEmail({
  firstName: 'Anthony',
  projectName: 'Se Levanta',
  gateCode: '6184#',
  vehicles: [
    { unitName: 'Pass #9', category: 'Passenger Van (12)', licensePlate: '8KCC180', lockboxCode: '45726', window: 'Sep 11 – Sep 12' },
  ],
  note: null,
  repName: 'Jose Pacheco',
  repPhone: '(818) 555-0100',
  repEmail: 'jose@sirreel.com',
})
check('subject names the unit and the project', one.subject === 'After-hours pickup · Pass #9 · Se Levanta', one.subject)
for (const half of ['html', 'text'] as const) {
  const body = one[half]
  check(`${half}: address`, body.includes('8500 Lankershim Blvd') && body.includes('Sun Valley, CA 91352'))
  check(`${half}: gate 1 + code`, body.includes('Gate 1') && body.includes('6184#'))
  check(`${half}: press slowly line`, body.includes('Press the numbers slowly and firmly'))
  check(`${half}: drivers license reminder`, /driver(&rsquo;|')s license handy/.test(body))
  check(`${half}: plate`, body.includes('8KCC180'))
  check(`${half}: lock box code`, body.includes('45726'))
  check(`${half}: rental window`, body.includes('Sep 11 – Sep 12'))
  check(`${half}: 24-hour line`, body.includes('(888) 477-7335'))
  check(`${half}: no dead sirreel.com links`, !/sirreel\.com\/(vehiclemap|lockbox)/i.test(body))
  check(`${half}: maps link`, body.includes('google.com/maps'))
}
check('text: rep sign-off', one.text.includes('— Jose Pacheco, (818) 555-0100 · jose@sirreel.com'))
check('html: greets by first name', one.html.includes('Anthony —'))
check('no note → no callout', !one.html.includes('For this pickup') && !one.text.includes('For this pickup'))

console.log('two vehicles')
const two = buildVehiclePickupEmail({
  projectName: 'Chad Powers',
  gateCode: '6184#',
  vehicles: [
    { unitName: 'Pass #9', category: null, licensePlate: '8KCC180', lockboxCode: '45726', window: null },
    { unitName: 'Cube 27', category: 'Cube Truck', licensePlate: '9ABC123', lockboxCode: '11223', window: null },
  ],
  note: 'Both are in the north row, nose out.',
})
check('subject lists both', two.subject === 'After-hours pickup · Pass #9 and Cube 27 · Chad Powers', two.subject)
check('html: both plates', two.html.includes('8KCC180') && two.html.includes('9ABC123'))
check('html: both lock box codes', two.html.includes('45726') && two.html.includes('11223'))
check('text: both blocks', (two.text.match(/Vehicle Lock Box Code:/g) || []).length === 2)
check('text: no window line when null', !two.text.includes('On the books'))
check('note renders in both halves', two.html.includes('north row, nose out') && two.text.includes('For this pickup: Both are in the north row'))
check('plural copy', two.html.includes('your drivers need') && two.text.includes('your drivers need'))
check('no name → Hi', two.html.includes('Hi —'))

console.log('escaping')
const evil = buildVehiclePickupEmail({
  projectName: 'A <b>B</b> & C',
  gateCode: '1<2',
  vehicles: [{ unitName: 'X <y>', category: null, licensePlate: null, lockboxCode: '<z>', window: null }],
  note: '<script>alert(1)</script>',
})
check('html escapes project', evil.html.includes('A &lt;b&gt;B&lt;/b&gt; &amp; C') && !evil.html.includes('<b>B</b>'))
check('html escapes note', !evil.html.includes('<script>'))
check('html escapes codes and unit', evil.html.includes('&lt;z&gt;') && evil.html.includes('X &lt;y&gt;') && evil.html.includes('1&lt;2'))
check('missing plate → no plate row (never a dash the driver reads as "no plate")', !evil.text.includes('License Plate') && !evil.html.includes('License plate'))
check('missing plate still carries the lock box code', evil.text.includes('Vehicle Lock Box Code: <z>'))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
