/**
 * CC list parsing + merge — the rules that decide who gets copied.
 *
 * Worth a test because both failure directions are silent and land in a
 * client's inbox: a typo that quietly does not copy the person the rep meant
 * to copy, and a merge that drops the job contacts send-quote already CCs.
 *
 * Run: npm run test:cc
 */
import { splitCcInput, parseCcList, mergeCc, MAX_CC } from '@/lib/email/ccList'
let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

eq('empty', parseCcList(''), [])
eq('single', parseCcList('ana@sirreel.com'), ['ana@sirreel.com'])
eq('comma + spaces', parseCcList(' ana@sirreel.com ,  hugo@sirreel.com '), ['ana@sirreel.com', 'hugo@sirreel.com'])
eq('semicolon (Outlook paste)', parseCcList('ana@sirreel.com; hugo@sirreel.com'), ['ana@sirreel.com', 'hugo@sirreel.com'])
eq('case + dupe', parseCcList('Ana@SirReel.com, ana@sirreel.com'), ['ana@sirreel.com'])
eq('display name rejected', splitCcInput('Ana <ana@sirreel.com>').invalid, ['Ana <ana@sirreel.com>'])
eq('no tld rejected', splitCcInput('ana@localhost').invalid, ['ana@localhost'])
eq('bare word rejected', splitCcInput('ana').invalid, ['ana'])
eq('missing @ rejected', splitCcInput('ana.sirreel.com').invalid, ['ana.sirreel.com'])
eq('valid survives beside invalid', splitCcInput('ana@sirreel.com, oops').valid, ['ana@sirreel.com'])
eq('cap enforced', parseCcList('a@x.com,b@x.com,c@x.com,d@x.com,e@x.com,f@x.com').length, MAX_CC)
eq('array input', parseCcList(['a@x.com', 'b@x.com']), ['a@x.com', 'b@x.com'])
eq('garbage input', parseCcList(null), [])

// mergeCc — the send-quote case
eq('merge keeps auto + manual', mergeCc(['pm@x.com'], ['ana@sirreel.com'], ['primary@x.com']), ['pm@x.com', 'ana@sirreel.com'])
eq('merge drops the To address', mergeCc(['pm@x.com'], ['primary@x.com'], ['primary@x.com']), ['pm@x.com'])
eq('merge dedupes across both', mergeCc(['pm@x.com'], ['PM@x.com'], []), ['pm@x.com'])
eq('merge empty → undefined', mergeCc([], [], []), undefined)
eq('merge with no manual keeps auto', mergeCc(['pm@x.com'], [], []), ['pm@x.com'])

console.log(fail === 0 ? '\nall cc checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
