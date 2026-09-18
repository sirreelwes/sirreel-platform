/**
 * Where "back" goes from an order page (2026-09-17 — Wes: opening an order
 * from a job and pressing back landed on the master list).
 *
 * Run: npm run test:order-back
 */
import { FROM_JOB, ORDERS_LIST, orderBackTarget, orderHrefFromJob } from '@/lib/nav/orderBackTarget'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}
const yes = (label: string, cond: boolean) => eq(label, cond, true)

const job = { id: 'job-0312', jobCode: 'SR-JOB-0312' }

// The reported flow.
eq('from a job: back to that job', orderBackTarget({ from: FROM_JOB, job }), { href: '/jobs/job-0312', label: 'Back to SR-JOB-0312' })
eq('the link a job-side control uses', orderHrefFromJob('ord-1'), '/orders/ord-1?from=job')
yes('and the two agree', orderHrefFromJob('ord-1').endsWith(`?from=${FROM_JOB}`))

// Everyone else keeps the list.
eq('no marker: the Orders list', orderBackTarget({ from: null, job }), ORDERS_LIST)
eq('undefined marker: the Orders list', orderBackTarget({ from: undefined, job }), ORDERS_LIST)
eq('a marker we do not know: the Orders list', orderBackTarget({ from: 'somewhere', job }), ORDERS_LIST)

// A job-marked order that somehow has no job still has to land somewhere.
eq('marked but no job: the Orders list', orderBackTarget({ from: FROM_JOB, job: null }), ORDERS_LIST)
eq('marked but the job has no id: the Orders list', orderBackTarget({ from: FROM_JOB, job: { id: '', jobCode: 'SR-JOB-1' } }), ORDERS_LIST)
eq('a job with no code still reads sensibly', orderBackTarget({ from: FROM_JOB, job: { id: 'j1', jobCode: '' } }), { href: '/jobs/j1', label: 'Back to the job' })

// No path is ever taken from the query string, so a crafted one goes nowhere.
const crafted = orderBackTarget({ from: 'https://evil.example.com', job })
eq('a URL in the marker is not a destination', crafted, ORDERS_LIST)
yes('every destination is one we built', [ORDERS_LIST.href, `/jobs/${job.id}`].includes(orderBackTarget({ from: FROM_JOB, job }).href))

if (fail) { console.error(`\n${fail} failing`); process.exit(1) }
console.log('\nall good')
