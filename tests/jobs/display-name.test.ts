/**
 * Client-facing job-name resolver tests.
 *
 *   npx tsx tests/jobs/display-name.test.ts
 *   npm run test:display-name
 *
 * Pure + offline. This decides the headline a CLIENT reads on their
 * paperwork portal and the production title printed on a signed rental
 * agreement, so the case that matters most is the one that already
 * happened: on 2026-09-02 a portal went out to a real client titled
 * "Planyo import — cart 5772289" — our internal cart id — while the job
 * had already been renamed "Retirement" in HQ.
 *
 * Two failure directions:
 *   · a placeholder leaking through → the client sees our plumbing
 *   · over-eager matching → a real show whose name merely resembles the
 *     placeholder gets replaced by the company name
 */

import { resolveDisplayJobName, isPlaceholderJobName } from '../../src/lib/jobs/displayName'

const failures: string[] = []

function eq(got: string | boolean, want: string | boolean, why: string): void {
  if (got === want) {
    console.log(`  ok — ${why}`)
  } else {
    console.log(`  FAIL — ${why}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
    failures.push(why)
  }
}

console.log('\nisPlaceholderJobName')
eq(isPlaceholderJobName('Planyo import — cart 5772289'), true, 'the exact string the importer minted (em dash)')
eq(isPlaceholderJobName('Planyo import - cart 5772289'), true, 'hyphen variant')
eq(isPlaceholderJobName('planyo import — cart 123'), true, 'case-insensitive')
eq(isPlaceholderJobName(''), true, 'empty is "not named yet"')
eq(isPlaceholderJobName('   '), true, 'whitespace-only is "not named yet"')
eq(isPlaceholderJobName(null), true, 'null is "not named yet"')
eq(isPlaceholderJobName('Retirement'), false, 'a real show name')
// Over-eager matching would silently rename a real production.
eq(isPlaceholderJobName('Planyo Import Documentary'), false, 'a real show whose name merely starts with the words')
eq(isPlaceholderJobName('Cart 5772289'), false, 'a real name containing a number')

console.log('\nresolveDisplayJobName — precedence')
eq(
  resolveDisplayJobName({ jobName: 'Retirement', bookingJobName: 'Planyo import — cart 5772289', companyName: 'Supplying Demand Inc' }),
  'Retirement',
  'the HQ rename wins over the booking placeholder (the 2026-09-02 incident)',
)
eq(
  resolveDisplayJobName({ jobName: 'Planyo import — cart 5770631', bookingJobName: 'GOV CAMPAIGN', companyName: 'Split Ends' }),
  'GOV CAMPAIGN',
  'a placeholder Job.name falls through to the real booking name',
)
eq(
  resolveDisplayJobName({ jobName: 'Connections DCA', bookingJobName: 'Connections DCA', companyName: 'Channel 3 Films' }),
  'Connections DCA',
  'both real and equal — unchanged',
)
eq(
  resolveDisplayJobName({ jobName: 'Retirement', bookingJobName: 'Second Unit Pickup', companyName: 'Supplying Demand Inc' }),
  'Retirement',
  'Job.name leads so an HQ edit is what propagates',
)

console.log('\nresolveDisplayJobName — fallbacks')
eq(
  resolveDisplayJobName({ jobName: '', bookingJobName: '', companyName: 'Tuff Creative' }),
  'Tuff Creative',
  'unnamed everywhere falls back to the company, not a blank heading',
)
eq(
  resolveDisplayJobName({ jobName: 'Planyo import — cart 5766977', bookingJobName: 'Planyo import — cart 5766977', companyName: 'Tuff Creative' }),
  'Tuff Creative',
  'placeholder on BOTH columns still reaches the company',
)
eq(
  resolveDisplayJobName({}),
  'Reservation',
  'nothing at all — a generic noun, never an empty string',
)
eq(
  resolveDisplayJobName({ jobName: null, bookingJobName: null, companyName: null }),
  'Reservation',
  'all null — same',
)
eq(
  resolveDisplayJobName({ bookingJobName: '  Happy Place  ' }),
  'Happy Place',
  'trims',
)

console.log(
  failures.length ? `\n${failures.length} FAILED\n` : '\nall passed\n',
)
process.exit(failures.length ? 1 : 0)
