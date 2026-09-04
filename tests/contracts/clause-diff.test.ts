import { diffClause, hasRealChange } from '@/lib/contracts/clauseDiff'

let failures = 0
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok  ${name}`)
  } else {
    failures++
    console.error(`FAIL  ${name}`, detail ?? '')
  }
}

const render = (segs: ReturnType<typeof diffClause>) =>
  segs.map((s) => (s.op === 'same' ? s.text : `[${s.op}:${s.text}]`)).join('')

// The three real My Darling California edits.
{
  const before = 'covering owned, non-owned, hired and rented vehicles'
  const after = 'covering non-owned, hired and rented vehicles'
  const segs = diffClause(before, after)
  check('strike of a single word is a del', segs.some((s) => s.op === 'del' && s.text.includes('owned,')), render(segs))
  check('no insertions when only striking', !segs.some((s) => s.op === 'ins'), render(segs))
  check('rejoining dels + sames rebuilds the original', segs.filter((s) => s.op !== 'ins').map((s) => s.text).join('') === before)
  check('rejoining ins + sames rebuilds the amendment', segs.filter((s) => s.op !== 'del').map((s) => s.text).join('') === after)
}

{
  const before = 'include replacement cost for physical damage'
  const after = 'include actual cash value for physical damage'
  const segs = diffClause(before, after)
  check('a swap shows both halves', segs.some((s) => s.op === 'del') && segs.some((s) => s.op === 'ins'), render(segs))
  check('unchanged tail stays same', segs.some((s) => s.op === 'same' && s.text.includes('physical damage')), render(segs))
}

{
  const before = 'repair cost of the Equipment (if the Equipment'
  const after = 'repair cost of the Equipment, and the actual cash value as it pertains to vehicles (if the Equipment'
  const segs = diffClause(before, after)
  // "Equipment" -> "Equipment," is a real token change: the insertion added a
  // comma. Showing it is honest — the only thing "deleted" is the unpunctuated
  // word, and its replacement sits right beside it.
  const deleted = segs.filter((s) => s.op === 'del').map((s) => s.text).join('')
  check('an insertion deletes nothing but the re-punctuated word', deleted === 'Equipment', render(segs))
  check('insertion carries the new language', segs.some((s) => s.op === 'ins' && s.text.includes('actual cash value')), render(segs))
}

// Identical text is entirely unchanged — the guard that stops a no-op
// amendment being presented as a redline.
{
  const same = 'You shall, at your own expense, maintain insurance.'
  check('identical text has no ops', diffClause(same, same).every((s) => s.op === 'same'))
  check('hasRealChange is false for identical text', !hasRealChange(same, same))
}

// Re-wrapping is not an edit.
{
  const before = 'one two three'
  const after = 'one  two\nthree'
  check('whitespace-only differences are not real changes', !hasRealChange(before, after), render(diffClause(before, after)))
}

// Round-trip on a full clause.
{
  const before =
    'Unless otherwise agreed in writing, you shall be responsible to us for the replacement cost value or repair cost of the Equipment (if the Equipment can be restored, by repair, to its pre-loss condition) whichever is less.'
  const after =
    'Unless otherwise agreed in writing, you shall be responsible to us for the replacement cost value or repair cost of the Equipment, and the actual cash value as it pertains to vehicles (if the Equipment can be restored, by repair, to its pre-loss condition) whichever is less.'
  const segs = diffClause(before, after)
  check('full clause: original round-trips', segs.filter((s) => s.op !== 'ins').map((s) => s.text).join('') === before)
  check('full clause: amendment round-trips', segs.filter((s) => s.op !== 'del').map((s) => s.text).join('') === after)
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nclause-diff: all checks passed')
