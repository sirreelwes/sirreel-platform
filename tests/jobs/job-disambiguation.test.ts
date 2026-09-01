/**
 * When does the Job resolver modal earn its interruption?
 *   npm run test:job-disambiguation
 *
 * Wes, 2026-08-31, after parsing an email and hitting send: "it opens a
 * redundant page, which asks for the client info again (she uploaded it
 * herself) as well as asks about job and company again."
 *
 * Scores come from resolveJob's rungs:
 *   thread 100 · planyoCart 90 · companyDates 60 · contact 50 ·
 *   nameHint 40 · and 35 for merely being an open job at the same
 *   company, which is the one that made the modal universal.
 */

import { needsJobDisambiguation, SAME_JOB_EVIDENCE_SCORE } from '../../src/lib/jobs/jobDisambiguation'

const failures: string[] = []
const check = (c: boolean, why: string) => {
  console.log(c ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!c) failures.push(why)
}
const res = (bucket: 'CLEAN_MATCH' | 'CANDIDATES' | 'NO_MATCH', ...scores: number[]) => ({
  bucket, candidates: scores.map((score) => ({ score })),
})

console.log('Nothing to disambiguate → do not interrupt')
check(!needsJobDisambiguation(res('NO_MATCH')),
  'a brand-new client and job asks nothing — every field would be the page\'s own')
check(!needsJobDisambiguation(res('CANDIDATES')),
  'a CANDIDATES bucket with an empty list still asks nothing')

console.log('\nThe company rung alone is not evidence of a duplicate')
check(!needsJobDisambiguation(res('CANDIDATES', 35)),
  '35 = "open job at the same company" — true of every repeat client, and those jobs are already listed inline on the page')
check(!needsJobDisambiguation(res('CANDIDATES', 35, 35, 35)),
  'three unrelated jobs at that company are still not a duplicate warning')

console.log('\nReal same-job evidence still stops and asks')
check(needsJobDisambiguation(res('CANDIDATES', 40)), 'a matching job NAME asks (40)')
check(needsJobDisambiguation(res('CANDIDATES', 50)), 'a matching CONTACT asks (50)')
check(needsJobDisambiguation(res('CANDIDATES', 60)), 'same company AND overlapping dates asks (60)')
check(needsJobDisambiguation(res('CLEAN_MATCH', 100)), 'the same email thread asks (100)')
check(needsJobDisambiguation(res('CANDIDATES', 75)),
  'the real case: SR-JOB-0268 "Hulu Chad Powers" scored 75 — same company AND name. That one IS a duplicate and must interrupt')

console.log('\nThe line sits below every identity rung and above the company one')
check(SAME_JOB_EVIDENCE_SCORE === 40, 'the threshold is the nameHint rung')
check(!needsJobDisambiguation(res('CANDIDATES', SAME_JOB_EVIDENCE_SCORE - 1)), 'one below asks nothing')
check(needsJobDisambiguation(res('CANDIDATES', SAME_JOB_EVIDENCE_SCORE)), 'exactly on it asks')

console.log('\nOnly the TOP candidate decides')
check(needsJobDisambiguation(res('CANDIDATES', 75, 35, 35)),
  'a real match leading a pile of company-only hits still asks')
check(!needsJobDisambiguation(res('CANDIDATES', 35, 35)),
  'and a pile of company-only hits never adds up to one — this is a threshold, not a sum')

console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll job-disambiguation tests passed.')
process.exitCode = failures.length ? 1 : 0
