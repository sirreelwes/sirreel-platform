/**
 * Which catalog row owns an RW ICode when several carry it.
 *
 * The rule the sync applies, isolated: an ORDERABLE row beats an archived
 * one. Resolving a barcode to an archived row is the quiet failure —
 * `unmatched` reads zero, the units look linked, and the check sheet
 * still offers no scanner because nobody can book that product. It
 * stranded 43 units in 2026-09-13's dedupe and 3 codes were still
 * stranded on 2026-09-18.
 */

import assert from 'node:assert'

/** Mirrors the sort in syncInventoryUnits.ts — orderable first. */
function ownerOf(rows: Array<{ id: string; rwICode: string | null; archivedAt: Date | null }>): Map<string, string> {
  const by = new Map<string, string>()
  for (const c of [...rows].sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt))) {
    if (c.rwICode && !by.has(c.rwICode)) by.set(c.rwICode, c.id)
  }
  return by
}

let pass = 0
const check = (name: string, fn: () => void) => { fn(); pass++; console.log(`  ✓ ${name}`) }
const arch = new Date('2026-05-24T00:00:00Z')

console.log('\nICode ownership')

check('a live row beats an archived one, whatever the order', () => {
  const live = { id: 'live', rwICode: '104401', archivedAt: null }
  const dead = { id: 'dead', rwICode: '104401', archivedAt: arch }
  assert.strictEqual(ownerOf([dead, live]).get('104401'), 'live')
  assert.strictEqual(ownerOf([live, dead]).get('104401'), 'live')
})

check('all-archived still resolves — a scan naming the product beats nothing', () => {
  assert.strictEqual(
    ownerOf([{ id: 'a', rwICode: '999', archivedAt: arch }, { id: 'b', rwICode: '999', archivedAt: arch }]).get('999'),
    'a',
  )
})

check('colour variants: first live row wins, as before', () => {
  const rows = [
    { id: 'black', rwICode: '104388', archivedAt: null },
    { id: 'blue', rwICode: '104388', archivedAt: null },
  ]
  assert.strictEqual(ownerOf(rows).get('104388'), 'black')
})

check('an unrelated code is untouched', () => {
  const by = ownerOf([
    { id: 'x', rwICode: '103845', archivedAt: null },
    { id: 'y', rwICode: '104401', archivedAt: arch },
  ])
  assert.strictEqual(by.get('103845'), 'x')
  assert.strictEqual(by.get('104401'), 'y')
})

console.log(`\n${pass} checks passed\n`)
