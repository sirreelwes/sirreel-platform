/**
 * The job Conversation — pure rules.
 *
 *   npm run test:job-conversation
 *
 * Offline. Guards who-wrote-it, the lane a row lands in, the system-row
 * labels, the claim transitions, note cleaning, @mentions, the merged
 * timeline order, and the "client is waiting on us" signal.
 */

import {
  alertSummary,
  applyClaim,
  urgentPlan,
  urgentSmsText,
  URGENT_SMS_EXCERPT,
  awaitingReply,
  bareAddress,
  claimLabel,
  cleanNote,
  kindFor,
  labelDetail,
  labelFromTriageNotes,
  laneFor,
  mentionsIn,
  mergeTimeline,
  NOTE_MAX,
  systemLabel,
} from '../../src/lib/email/conversationRules'

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok   ${name}`)
  else { failures++; console.log(`  FAIL ${name}`, detail ?? '') }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

console.log('\n— who wrote it —')
check('bareAddress strips a display name', bareAddress('Sarah Chen <Sarah@AcmePictures.com>') === 'sarah@acmepictures.com')
check('client: inbound from outside', kindFor({ direction: 'inbound', fromAddress: 'Sarah Chen <sarah@acmepictures.com>' }) === 'client')
check('staff: any sirreel.com sender, whatever the direction', kindFor({ direction: 'outbound', fromAddress: 'jose@sirreel.com' }) === 'staff'
  && kindFor({ direction: 'inbound', fromAddress: 'Ana <ana@sirreel.com>' }) === 'staff')
check('system: the notifications sender', kindFor({ direction: 'outbound', fromAddress: 'SirReel HQ <notifications@sirreel.com>' }) === 'system')

console.log('\n— lanes —')
check('client reply that landed in jose@ is Sales', laneFor({ kind: 'client', fromAddress: 'sarah@acmepictures.com', deliveredTo: 'jose@sirreel.com', toAddresses: ['jose@sirreel.com'] }) === 'SALES')
check('client reply that landed in billing@ is Billing', laneFor({ kind: 'client', fromAddress: 'dev@acmepictures.com', deliveredTo: 'billing@sirreel.com', toAddresses: ['billing@sirreel.com'] }) === 'BILLING')
check('client reply-all that only Cc\'d billing@ is Billing', laneFor({ kind: 'client', fromAddress: 'dev@acmepictures.com', deliveredTo: 'jobs@sirreel.com', toAddresses: ['jobs@sirreel.com'], ccAddresses: 'billing@sirreel.com, jobs+sr-job-0219@sirreel.com' }) === 'BILLING')
check('staff with the BILLING role is Billing whatever the address', laneFor({ kind: 'staff', fromAddress: 'ana@sirreel.com', authorRole: 'BILLING' }) === 'BILLING')
check('staff sales rep is Sales', laneFor({ kind: 'staff', fromAddress: 'jose@sirreel.com', authorRole: 'AGENT' }) === 'SALES')
check('system invoice send is Billing', laneFor({ kind: 'system', fromAddress: 'notifications@sirreel.com', label: 'send-invoice:INV-1042' }) === 'BILLING')
check('system quote send is Sales', laneFor({ kind: 'system', fromAddress: 'notifications@sirreel.com', label: 'send-quote:S260912-003' }) === 'SALES')

console.log('\n— system rows —')
check('label round-trips through triageNotes', labelFromTriageNotes('label:send-quote:S260912-003') === 'send-quote:S260912-003')
check('no label → null', labelFromTriageNotes(null) === null && labelFromTriageNotes('triage: call back') === null)
check('quote', systemLabel('send-quote:S260912-003') === 'Quote sent')
check('welcome', systemLabel('job-welcome') === 'Welcome email')
check('paperwork', systemLabel('paperwork-summary') === 'Paperwork summary')
check('follow-up', systemLabel('follow-up:STAGE_2:S260912-003') === 'Follow-up')
check('portal invite', systemLabel('portal/invite') === 'Portal invite')
check('invoice', systemLabel('send-invoice:INV-1042') === 'Invoice sent')
check('pre-invoice', systemLabel('send-pre-invoice:INV-1042') === 'Pre-invoice sent')
check('unknown label still reads', systemLabel('something-new') === 'Sent by HQ' && systemLabel(null) === 'Sent by HQ')
// 2026-09-17: every client-facing send on a known job rides the thread, so
// each of the labels those sites stamp needs a name — none may fall through.
const WIRED_LABELS = [
  'resend-quote-on-change:check-out:S260912-003', 'card-auth-request', 'card-auth-handoff', 'self-serve:S260912-003',
  'thank-you:S260912-003', 'orders/agreement/resend-link', 'portal/resend-link:S260912-003', 'orders/contacts/invite',
  'portal/authorize-approved-invite', 'orders/contract-review/accept', 'contract-review/counter-notice',
  'agreement/reissue:S260912-003', 'portal/agreement/sign', 'portal/v2/stage-sign client confirmation',
  'stage-ready-to-sign', 'final-invoice-payment-options', 'payment-info-operator-send', 'payment-share',
  'job/after-hours', 'job/after-hours-share', 'job/vehicle-pickup', 'driver/request', 'coi-request-fix',
  'coi-approved', 'coi-requirements:S260912-003', 'sub-rental-estimate',
]
check('every wired send label has its own name', WIRED_LABELS.every((l) => systemLabel(l) !== 'Sent by HQ'), WIRED_LABELS.filter((l) => systemLabel(l) === 'Sent by HQ'))
check('after-hours share is not read as after-hours access', systemLabel('job/after-hours-share') !== systemLabel('job/after-hours'))
check('final invoice, payment details and payment share are Billing', ['final-invoice-payment-options', 'payment-info-operator-send', 'payment-share'].every((l) => laneFor({ kind: 'system', fromAddress: 'notifications@sirreel.com', label: l }) === 'BILLING'))
check('card authorization is Sales', laneFor({ kind: 'system', fromAddress: 'notifications@sirreel.com', label: 'card-auth-request' }) === 'SALES')
check('detail is the last segment', labelDetail('send-quote:S260912-003') === 'S260912-003' && labelDetail('follow-up:STAGE_2:S260912-003') === 'S260912-003' && labelDetail('job-welcome') === null)

console.log('\n— claim —')
const t0 = new Date('2026-09-17T10:00:00Z')
const none = { claimedByUserId: null, claimedLane: null, claimedAt: null }
const jose = applyClaim(none, { action: 'claim', userId: 'u-jose' }, t0)
check('claim → the actor, Sales by default', eq(jose, { claimedByUserId: 'u-jose', claimedLane: 'SALES', claimedAt: t0 }))
const handed = applyClaim(jose, { action: 'hand', lane: 'BILLING' }, t0)
check('hand to Billing → nobody holding it, lane Billing', eq(handed, { claimedByUserId: null, claimedLane: 'BILLING', claimedAt: t0 }))
const ana = applyClaim(handed, { action: 'claim', userId: 'u-ana' }, t0)
check('a claim after a hand keeps the lane', eq(ana, { claimedByUserId: 'u-ana', claimedLane: 'BILLING', claimedAt: t0 }))
check('release clears everything', eq(applyClaim(ana, { action: 'release' }, t0), none))
const nameOf = (id: string) => ({ 'u-jose': 'Jose Pacheco', 'u-ana': 'Ana' } as Record<string, string>)[id] ?? null
check('chip: "<name> is answering"', claimLabel(jose, nameOf) === 'Jose Pacheco is answering')
check('chip: "Handed to Billing"', claimLabel(handed, nameOf) === 'Handed to Billing')
check('chip: nothing when unclaimed', claimLabel(none, nameOf) === null)
check('chip: unknown user still reads', claimLabel({ ...jose, claimedByUserId: 'u-gone' }, nameOf) === 'Someone is answering')

console.log('\n— notes —')
check('cleanNote trims and keeps', cleanNote('  @Ana same invoice please \n') === '@Ana same invoice please')
check('cleanNote refuses empty / non-string', cleanNote('   ') === null && cleanNote(null) === null && cleanNote(42) === null)
check('cleanNote bounds the length', (cleanNote('x'.repeat(NOTE_MAX + 50)) ?? '').length === NOTE_MAX)
const staff = [
  { id: 'u-jose', name: 'Jose Pacheco' },
  { id: 'u-ana', name: 'Ana' },
  { id: 'u-julian', name: 'Julian' },
]
check('@First matches', eq(mentionsIn('@Ana same invoice. @Julian liftgate on 27 or 31?', staff), ['u-ana', 'u-julian']))
check('@First Last matches', eq(mentionsIn('cc @Jose Pacheco on this', staff), ['u-jose']))
check('@First followed by a capitalised word still matches the person', eq(mentionsIn('@Ana Please check', staff), ['u-ana']))
check('unknown name matches nobody, bare @ matches nobody', eq(mentionsIn('@Nobody and @ and email@x.com', staff), []))
check('a mention is recorded once', eq(mentionsIn('@Ana @ana @Ana', staff), ['u-ana']))

console.log('\n— timeline —')
const e1 = { id: 'e1', at: new Date('2026-09-12T10:00:00Z') }
const n1 = { id: 'n1', at: new Date('2026-09-12T10:00:00Z') }
const e2 = { id: 'e2', at: new Date('2026-09-12T11:00:00Z') }
const n0 = { id: 'n0', at: new Date('2026-09-12T09:00:00Z') }
check('merged oldest first, email before note on a tie', eq(mergeTimeline([e2, e1], [n1, n0]).map((r) => r.id), ['n0', 'e1', 'n1', 'e2']))

console.log('\n— urgent notes —')
const team = [
  { id: 'u-jose', name: 'Jose Pacheco', email: 'jose@sirreel.com', phone: '(818) 555-0101' },
  { id: 'u-ana', name: 'Ana', email: 'ana@sirreel.com', phone: null },
  { id: 'u-chris', name: 'Chris Valencia', email: '', phone: '' },
]
const plan = urgentPlan({ mentions: ['u-jose', 'u-ana', 'u-chris', 'u-jose'], authorUserId: 'u-wes', staff: team })
check('text beats email, email beats nothing', eq(plan.map((p) => [p.userId, p.channel, p.to]), [
  ['u-jose', 'SMS', '(818) 555-0101'],
  ['u-ana', 'EMAIL', 'ana@sirreel.com'],
  ['u-chris', 'NONE', null],
]))
check('the author is never alerted', urgentPlan({ mentions: ['u-jose'], authorUserId: 'u-jose', staff: team }).length === 0)
check('an unknown id is dropped, not guessed', urgentPlan({ mentions: ['u-gone'], authorUserId: 'u-wes', staff: team }).length === 0)
const sms = urgentSmsText({ byName: 'Jose Pacheco', jobName: 'Cleveland Golf', jobCode: 'SR-JOB-0369', body: '@Ana client needs the final invoice before 3pm', url: 'https://hq.sirreel.com/jobs/abc?tab=conversation' })
check('text names who, the job, the note and the link', sms === 'URGENT from Jose on Cleveland Golf (SR-JOB-0369): @Ana client needs the final invoice before 3pm https://hq.sirreel.com/jobs/abc?tab=conversation', sms)
const long = urgentSmsText({ byName: 'Ana', jobName: 'J', jobCode: 'SR-JOB-1', body: 'x'.repeat(500), url: 'https://h.q/j' })
check('a long note is cut to the excerpt with an ellipsis', long.includes('…') && long.length < URGENT_SMS_EXCERPT + 60, long.length)
check('summary reads who was reached and how', alertSummary([
  { name: 'Jose Pacheco', channel: 'SMS', status: 'SENT' },
  { name: 'Ana', channel: 'EMAIL', status: 'SENT' },
  { name: 'Chris Valencia', channel: 'NONE', status: 'SKIPPED' },
  { name: 'Julian', channel: 'SMS', status: 'FAILED' },
]) === 'texted Jose · emailed Ana · Chris unreachable (no mobile or email) · text to Julian failed')
check('no alerts → empty summary', alertSummary([]) === '')

console.log('\n— waiting on us —')
const at = (s: string) => new Date(s)
check('no client message → not waiting', awaitingReply([{ kind: 'system', at: at('2026-09-12T10:00Z') }]) === false)
check('client wrote last → waiting', awaitingReply([{ kind: 'system', at: at('2026-09-12T10:00Z') }, { kind: 'client', at: at('2026-09-12T11:00Z') }]) === true)
check('we answered after → not waiting', awaitingReply([{ kind: 'client', at: at('2026-09-12T11:00Z') }, { kind: 'staff', at: at('2026-09-12T11:30Z') }]) === false)
check('order of rows does not matter', awaitingReply([{ kind: 'staff', at: at('2026-09-12T11:30Z') }, { kind: 'client', at: at('2026-09-12T11:00Z') }]) === false)

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
