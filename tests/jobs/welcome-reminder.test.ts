/**
 * Job welcome reminder tests.
 *
 *   npx tsx tests/jobs/welcome-reminder.test.ts
 *   npm run test:welcome-reminder
 *
 * Pure + offline. The rule the /jobs tile chip, the job page button and
 * the send route share (Wes 2026-09-11): quote out + no welcome = due,
 * fading after the reminder window; the template carries Wes's wording
 * and the client's link.
 */
import {
  welcomeSignal,
  defaultJobWelcomeBody,
  WELCOME_REMINDER_WINDOW_DAYS,
} from '../../src/lib/jobs/welcomeReminder'
import { buildJobWelcomeEmail } from '../../src/lib/email/templates/jobWelcome'

const failures: string[] = []
function eq(got: unknown, want: unknown, why: string): void {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) console.log(`  ok — ${why}`)
  else { console.log(`  FAIL — ${why}\n      got  ${g}\n      want ${w}`); failures.push(why) }
}
function ok(cond: boolean, why: string): void { eq(cond, true, why) }

const now = new Date('2026-09-11T18:00:00Z')
const days = (n: number) => new Date(now.getTime() - n * 86_400_000)

console.log('welcomeSignal')
eq(welcomeSignal({ jobStatus: 'NEW', orders: [], sentAt: null, now }).state, 'none', 'no orders → none')
eq(
  welcomeSignal({ jobStatus: 'NEW', orders: [{ status: 'DRAFT', quoteSentAt: null }], sentAt: null, now }).state,
  'none',
  'draft, never quoted → none',
)
eq(
  welcomeSignal({ jobStatus: 'NEW', orders: [{ status: 'QUOTE_SENT', quoteSentAt: days(2) }], sentAt: null, now }).state,
  'due',
  'quoted 2 days ago, no welcome → due',
)
eq(
  welcomeSignal({ jobStatus: 'NEW', orders: [{ status: 'QUOTE_SENT', quoteSentAt: days(2) }], sentAt: days(1), now }).state,
  'sent',
  'welcome sent → sent',
)
eq(
  welcomeSignal({ jobStatus: 'NEW', orders: [{ status: 'QUOTE_SENT', quoteSentAt: days(2).toISOString() }], sentAt: days(1).toISOString(), now }),
  { state: 'sent', quotedAt: days(2), sentAt: days(1) },
  'ISO strings are accepted and echoed back as dates',
)
eq(
  welcomeSignal({ jobStatus: 'NEW', orders: [{ status: 'CANCELLED', quoteSentAt: days(2) }], sentAt: null, now }).state,
  'none',
  'a cancelled order\'s quote does not count',
)
eq(
  welcomeSignal({
    jobStatus: 'NEW',
    orders: [
      { status: 'DRAFT', quoteSentAt: null },
      { status: 'QUOTE_SENT', archivedAt: days(1), quoteSentAt: days(2) },
    ],
    sentAt: null,
    now,
  }).state,
  'none',
  'an archived twin\'s quote does not count beside a live order',
)
eq(
  welcomeSignal({ jobStatus: 'NEW', orders: [{ status: 'QUOTE_SENT', archivedAt: days(1), quoteSentAt: days(2) }], sentAt: null, now }).state,
  'due',
  'archiving a job\'s ONLY order falls back to it (liveOrdersForRollup) — still due',
)
eq(
  welcomeSignal({ jobStatus: 'NEW', orders: [{ status: 'QUOTE_SENT', quoteSentAt: days(WELCOME_REMINDER_WINDOW_DAYS + 1) }], sentAt: null, now }).state,
  'none',
  'quoted outside the window → fades to none',
)
eq(
  welcomeSignal({ jobStatus: 'NEW', orders: [{ status: 'QUOTE_SENT', quoteSentAt: days(WELCOME_REMINDER_WINDOW_DAYS - 1) }], sentAt: null, now }).state,
  'due',
  'quoted inside the window → due',
)
eq(
  welcomeSignal({
    jobStatus: 'NEW',
    orders: [
      { status: 'QUOTE_SENT', quoteSentAt: days(40) },
      { status: 'QUOTE_SENT', quoteSentAt: days(3) },
    ],
    sentAt: null,
    now,
  }),
  { state: 'due', quotedAt: days(3), sentAt: null },
  'newest quote wins — an old quote plus a fresh one is due',
)
eq(
  welcomeSignal({ jobStatus: 'NEW', orders: [{ status: 'ON_JOB', quoteSentAt: days(2) }], sentAt: null, now }),
  { state: 'none', quotedAt: days(2), sentAt: null },
  'gear already out (ON_JOB) → the welcome moment has passed; quotedAt still reported',
)
for (const st of ['RETURNED', 'LD_CHECK', 'INVOICED', 'CLOSED']) {
  eq(
    welcomeSignal({ jobStatus: 'NEW', orders: [{ status: st, quoteSentAt: days(2) }], sentAt: null, now }).state,
    'none',
    `${st} order → none`,
  )
}
for (const st of ['QUOTE_SENT', 'APPROVED', 'BOOKED', 'LOADED_READY']) {
  eq(
    welcomeSignal({ jobStatus: 'NEW', orders: [{ status: st, quoteSentAt: days(2) }], sentAt: null, now }).state,
    'due',
    `${st} order → due`,
  )
}
eq(
  welcomeSignal({
    jobStatus: 'NEW',
    orders: [
      { status: 'ON_JOB', quoteSentAt: days(10) },
      { status: 'QUOTE_SENT', quoteSentAt: days(1) },
    ],
    sentAt: null,
    now,
  }).state,
  'due',
  'an add-on quoted beside an order already out is still due',
)
eq(
  welcomeSignal({ jobStatus: 'WRAPPED', orders: [{ status: 'QUOTE_SENT', quoteSentAt: days(2) }], sentAt: null, now }).state,
  'none',
  'WRAPPED never nags',
)
eq(
  welcomeSignal({ jobStatus: 'LOST', orders: [{ status: 'QUOTE_SENT', quoteSentAt: days(2) }], sentAt: null, now }).state,
  'none',
  'LOST never nags',
)
eq(
  welcomeSignal({ jobStatus: 'WRAPPED', orders: [{ status: 'QUOTE_SENT', quoteSentAt: days(2) }], sentAt: days(1), now }).state,
  'sent',
  'a sent welcome still reads sent on a wrapped job',
)

console.log('defaultJobWelcomeBody')
const body = defaultJobWelcomeBody('Joelle')
ok(body.startsWith('Hi Joelle,'), 'greets by first name')
ok(body.includes('Welcome to SirReel.'), 'opens with Welcome to SirReel')
ok(body.includes('looking forward to working with you'), 'carries Wes\'s "looking forward" line')
ok(body.includes('provide you with a link to the job'), 'carries "a link to the job"')
ok(body.includes('Paperwork can be done here'), 'carries the paperwork line')
ok(body.includes('all the way to the final invoice being paid'), 'carries the final-invoice line')
ok(/log in/.test(body) && !/login,/.test(body), 'says "log in" (verb), not "login"')
ok(body.includes('just follow this link!'), 'ends on "just follow this link!"')
ok(defaultJobWelcomeBody(null).startsWith('Hi there,'), 'no name → "Hi there,"')
ok(!/Production Vehicles/i.test(body), 'never names the legal entity client-facing')

console.log('buildJobWelcomeEmail')
const sent = buildJobWelcomeEmail({
  jobName: 'Forgotten Island',
  body,
  portalLink: 'https://hq.sirreel.com/portal/job/abc?token=T0K',
  repName: 'Jose Pacheco',
  repPhone: '(818) 555-0100',
  repEmail: 'jose@sirreel.com',
})
eq(sent.subject, 'Welcome to SirReel · Forgotten Island', 'subject names the job')
ok(sent.html.includes('https://hq.sirreel.com/portal/job/abc?token=T0K'), 'html carries the tokenized link')
ok(sent.text.includes('Open your job: https://hq.sirreel.com/portal/job/abc?token=T0K'), 'text carries the link in the clear')
ok(sent.html.includes('Hi Joelle,'), 'html renders the greeting from the body')
ok(sent.html.includes('No login needed'), 'html says no login is needed')
ok(sent.html.includes('Jose Pacheco'), 'html signs off with the rep')
ok(sent.html.includes('#0F7A93') && !sent.html.includes('#c39a3f') && !sent.html.includes('#D4A547'), 'turquoise accent, no gold')
ok(!/Production Vehicles/i.test(sent.html) && !/Production Vehicles/i.test(sent.text), 'legal entity absent from both halves')

const preview = buildJobWelcomeEmail({ jobName: 'X', body: 'Hi,\n\n<b>bold</b> & "quoted"', portalLink: null, repName: 'R' })
ok(preview.html.includes('href="#"'), 'preview renders an inert button')
ok(preview.html.includes('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;'), 'rep text is HTML-escaped')
ok(preview.html.includes('<p style="margin:0 0 16px;">Hi,</p>'), 'blank line splits paragraphs')
ok(preview.text.includes('(link added when sent)'), 'preview text says the link is added at send')

if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1) }
console.log('\nall passed')
