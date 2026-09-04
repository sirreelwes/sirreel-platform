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

// Changed regions are coalesced into "what went, then what came", which
// collapses whitespace inside the region. Round-trips are therefore asserted
// on normalized whitespace — the words and their order must survive exactly,
// the spacing inside an edit is presentation.
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const rebuildOriginal = (segs: ReturnType<typeof diffClause>) =>
  norm(segs.filter((s) => s.op !== 'ins').map((s) => s.text).join(''))
const rebuildAmended = (segs: ReturnType<typeof diffClause>) =>
  norm(segs.filter((s) => s.op !== 'del').map((s) => s.text).join(''))

// The three real My Darling California edits.
{
  const before = 'covering owned, non-owned, hired and rented vehicles'
  const after = 'covering non-owned, hired and rented vehicles'
  const segs = diffClause(before, after)
  check('strike of a single word is a del', segs.some((s) => s.op === 'del' && s.text.includes('owned,')), render(segs))
  check('no insertions when only striking', !segs.some((s) => s.op === 'ins'), render(segs))
  check('rejoining dels + sames rebuilds the original', rebuildOriginal(segs) === norm(before), render(segs))
  check('rejoining ins + sames rebuilds the amendment', rebuildAmended(segs) === norm(after), render(segs))
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
  check('full clause: original round-trips', rebuildOriginal(segs) === norm(before), render(segs))
  check('full clause: amendment round-trips', rebuildAmended(segs) === norm(after), render(segs))
}

// Readability: a changed region shows the struck phrase WHOLE and then the
// added phrase WHOLE. Token-by-token alternation renders as
// "replacementactual costcash value" — legible only to someone who already
// knows what changed, which is the opposite of the point on a document a
// client signs.
{
  const before = 'and include replacement cost for physical damage'
  const after = 'and include actual cash value for physical damage'
  const segs = diffClause(before, after)
  const dels = segs.filter((s) => s.op === 'del')
  const ins = segs.filter((s) => s.op === 'ins')
  check('one struck run, not several', dels.length === 1, render(segs))
  check('one added run, not several', ins.length === 1, render(segs))
  check('struck run is the whole phrase', dels[0]?.text === 'replacement cost', render(segs))
  check('added run is the whole phrase', ins[0]?.text === 'actual cash value', render(segs))
  check('struck comes before added', segs.indexOf(dels[0]) < segs.indexOf(ins[0]), render(segs))
  check('the two are separated', segs[segs.indexOf(dels[0]) + 1]?.op === 'same', render(segs))
}

// Words must not weld to their neighbours when a region is trimmed.
{
  const segs = diffClause('covering owned, non-owned and hired', 'covering non-owned and hired')
  const flat = render(segs)
  check('no welded words after a strike', flat.includes('[del:owned,] non-owned'), flat)
}

{
  const before = '(ii) theft by fraudulent scheme (iii) mysterious disappearance (iv) loss of use'
  const after = '(ii) theft by fraudulent scheme (iv) actual and verifiable loss of use'
  const segs = diffClause(before, after)
  const flat = render(segs)
  check('clause 5 reads as one strike then one addition', /\[del:[^\]]*mysterious disappearance[^\]]*\]/.test(flat), flat)
  check('clause 5 addition is whole', /\[ins:[^\]]*actual and verifiable[^\]]*\]/.test(flat), flat)
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nclause-diff: all checks passed')
