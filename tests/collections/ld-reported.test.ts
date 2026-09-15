/**
 * L&D reported → billing@ (Ana, 2026-09-15), and the missing-gear rule the
 * Bill L&D composer shares with it.
 *
 * Guards:
 *   - 0 of N back classifies REMOVED, and it IS missing (the composer's
 *     first cut filtered on SHORT and hid exactly these)
 *   - ADDED / off-sheet / SUBSTITUTE lines are never a loss
 *   - a re-file of the same sheet announces nothing; a worse count or a
 *     piece that turned up does
 *   - the email says nothing is billed, and never prices an unpriced line at $0
 *
 * Run: npm run test:ld-reported
 */
import { diffMissingGear, missingOnCheckIn, type InboundLineFacts } from '../../src/lib/invoices/ldMissingGear'
import { buildLdReportedEmail } from '../../src/lib/email/templates/ldReported'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const truthy = (label: string, v: boolean) => eq(label, v, true)

const line = (id: string | null, expected: number, actual: number, over: Partial<InboundLineFacts> = {}): InboundLineFacts => {
  const change =
    !id ? 'ADDED' : actual === 0 && expected > 0 ? 'REMOVED' : actual < expected ? 'SHORT' : actual > expected ? 'EXTRA' : 'NONE'
  return { orderLineItemId: id, description: `Item ${id ?? 'added'}`, expectedQty: expected, actualQty: actual, change, onSheet: true, ...over }
}

// ── missingOnCheckIn ───────────────────────────────────────────────────
eq('SHORT is missing', missingOnCheckIn([line('a', 3, 1)]).map((m) => m.missing), [2])
eq('REMOVED (0 of 3) is missing', missingOnCheckIn([line('a', 3, 0)]).map((m) => m.missing), [3])
eq('complete line is not', missingOnCheckIn([line('a', 3, 3)]), [])
eq('EXTRA is not', missingOnCheckIn([line('a', 3, 4)]), [])
eq('ADDED row is not', missingOnCheckIn([line(null, 0, 2)]), [])
eq('off-sheet line is not', missingOnCheckIn([line('a', 3, 3, { onSheet: false, change: 'NONE' })]), [])
eq('SUBSTITUTE is not', missingOnCheckIn([line('a', 3, 1, { change: 'SUBSTITUTE' })]), [])

// ── diffMissingGear ────────────────────────────────────────────────────
{
  const d = diffMissingGear([], [line('a', 3, 0), line('b', 2, 2)])
  eq('first filing: new shortfall', d.newlyMissing.map((m) => [m.orderLineItemId, m.missing]), [['a', 3]])
  eq('first filing: nothing turned up', d.turnedUp, [])
}
{
  const sheet = [line('a', 3, 1), line('b', 2, 2)]
  const d = diffMissingGear(sheet, sheet)
  eq('re-file unchanged: silent', [d.newlyMissing.length, d.turnedUp.length], [0, 0])
}
{
  const d = diffMissingGear([line('a', 3, 2)], [line('a', 3, 0)])
  eq('worse re-count: reported at the new total', d.newlyMissing.map((m) => m.missing), [3])
}
{
  const d = diffMissingGear([line('a', 3, 0)], [line('a', 3, 3)])
  eq('piece turned up', d.turnedUp, [{ description: 'Item a', wasMissing: 3, nowMissing: 0 }])
  eq('…and nothing newly missing', d.newlyMissing, [])
}
{
  const d = diffMissingGear([line('a', 3, 0)], [line('a', 3, 3, { onSheet: false, change: 'NONE' })])
  eq('line off-sheet on a later pass has NOT turned up', d.turnedUp, [])
}
{
  const d = diffMissingGear([line('a', 3, 1)], [line('a', 3, 1), line('b', 4, 0)])
  eq('second pass adds a different shortfall only', d.newlyMissing.map((m) => m.orderLineItemId), ['b'])
}

// ── email ──────────────────────────────────────────────────────────────
const base = {
  orderNumbers: ['S260915-001'],
  jobName: 'Night Shoot',
  companyName: 'ZZTEST Productions',
  reportedBy: 'Chris',
  at: new Date('2026-09-15T18:00:00Z'),
  orderLink: 'https://hq.sirreel.com/orders/x',
  billingLink: 'https://hq.sirreel.com/collections',
}
{
  const m = buildLdReportedEmail({
    ...base,
    source: 'CHECK_IN',
    missing: [
      { description: 'Stinger 25ft', missing: 3, expectedQty: 3, actualQty: 0, note: null, replacementCost: 40 },
      { description: 'Sandbag', missing: 1, expectedQty: 10, actualQty: 9, note: 'maybe on truck', replacementCost: null },
    ],
    turnedUp: [],
    damage: [],
  })
  eq('subject counts units', m.subject, 'L&D: 4 items not returned — S260915-001 · Night Shoot · ZZTEST Productions')
  truthy('priced line totals qty × cost', m.text.includes('$120.00 to replace ($40.00 each)'))
  truthy('unpriced line says so, never $0', m.text.includes('no replacement cost on file') && !m.text.includes('$0.00'))
  truthy('says nothing is billed', m.text.includes('Nothing has been billed'))
  truthy('note carried', m.text.includes('maybe on truck'))
  truthy('html escapes', !m.html.includes('<script'))
}
{
  const m = buildLdReportedEmail({
    ...base,
    source: 'VEHICLE_RETURN',
    missing: [],
    turnedUp: [],
    damage: [{ unitName: 'Cube 4', location: 'rear bumper', damageType: 'DENT', severity: 'MODERATE', estimate: 650, notes: null }],
  })
  eq('damage subject names the unit', m.subject, 'L&D: new damage on Cube 4 — S260915-001 · Night Shoot · ZZTEST Productions')
  truthy('damage line reads plainly', m.text.includes('Cube 4: dent (moderate) at rear bumper — $650.00 repair estimate'))
}
{
  const m = buildLdReportedEmail({
    ...base,
    source: 'CHECK_IN',
    missing: [],
    turnedUp: [{ description: 'Stinger 25ft', wasMissing: 3, nowMissing: 0 }],
    damage: [],
  })
  eq('turned-up subject', m.subject, 'L&D update: missing gear turned up — S260915-001 · Night Shoot · ZZTEST Productions')
  truthy('turned-up has no "not billed" callout', !m.text.includes('Nothing has been billed'))
}
{
  const m = buildLdReportedEmail({
    ...base,
    source: 'CHECK_IN',
    jobName: '<b>x</b>',
    missing: [{ description: '<img src=x>', missing: 1, expectedQty: 1, actualQty: 0, note: null, replacementCost: null }],
    turnedUp: [],
    damage: [],
  })
  truthy('user text escaped in html', !m.html.includes('<img src=x>') && !m.html.includes('<b>x</b>'))
}

{
  const m = buildLdReportedEmail({
    ...base,
    source: 'INCIDENT',
    incidentNumber: 'INC-0042',
    missing: [],
    turnedUp: [],
    damage: [
      { unitName: 'Cube 4', location: 'liftgate', damageType: 'MECHANICAL', severity: 'MAJOR', estimate: 1800, notes: null, disposition: 'BILL_NOW' },
      { unitName: 'Cube 4', location: 'mirror', damageType: 'CRACK', severity: 'MINOR', estimate: null, notes: null, disposition: 'SEND_TO_LD' },
    ],
  })
  truthy('incident intro names the incident', m.text.includes('on incident INC-0042 for S260915-001'))
  truthy('incident row in details', m.text.includes('Incident: INC-0042'))
  truthy('BILL_NOW line says where it bills', m.text.includes('[bill now, on the rental invoice]'))
  truthy('BILL_NOW routing sentence', m.text.includes('goes on the next rental invoice automatically'))
  truthy('SEND_TO_LD routing sentence', m.text.includes('listed under Bill L&D now'))
  truthy('no PENDING sentence when nothing is pending', !m.text.includes('once its disposition'))
  truthy('no gear sentence without missing gear', !m.text.includes('short count'))
}
{
  const m = buildLdReportedEmail({
    ...base,
    source: 'VEHICLE_RETURN',
    missing: [],
    turnedUp: [],
    damage: [{ unitName: 'Cube 4', location: 'door', damageType: 'DENT', severity: 'MINOR', estimate: null, notes: null }],
  })
  truthy('return damage (no disposition) reads as pending triage', m.text.includes('once its disposition on the order is set to Send to L&D'))
}

if (fail) {
  console.error(`\n${fail} failing`)
  process.exit(1)
}
console.log('\nall passing')
