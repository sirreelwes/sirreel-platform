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
  chatPreview,
  chatTier,
  CHAT_PREVIEW_MAX,
  inclusionLabel,
  isBillingDesk,
  sortChatRows,
  strongestReason,
  urgentPlan,
  urgentSmsText,
  URGENT_SMS_EXCERPT,
  awaitingReply,
  bareAddress,
  claimLabel,
  cleanNote,
  internalNoteTells,
  isTagSuggested,
  MENTION_UNLISTED,
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
  'coi-approved', 'coi-requirements:S260912-003', 'coi-broker-review', 'sub-rental-estimate',
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

console.log('\n— the Chat page: who sees what —')
// Wes 2026-09-17: "the chats shouldn't be for everyone. It should be for
// everyone who is included in that chat … if it was directly @billing, it
// wouldn't show up in Hugo's and vice versa."
check('the strongest reason wins the row label', strongestReason(['rep', 'mentioned', 'wrote']) === 'mentioned')
check('no reason = not in your list', strongestReason([]) === null)
check('each reason says itself', inclusionLabel(['mentioned']) === 'You were tagged'
  && inclusionLabel(['holding']) === 'You are answering'
  && inclusionLabel(['wrote']) === 'You wrote here'
  && inclusionLabel(['rep']) === 'Your job'
  && inclusionLabel(['desk']) === 'Billing desk')
check('the billing desk is the role or the inbox', isBillingDesk({ role: 'BILLING' }) && isBillingDesk({ email: 'ana@sirreel.com' }) && isBillingDesk({ email: 'billing@sirreel.com' }))
check('Hugo is not the billing desk', !isBillingDesk({ role: 'MANAGER', email: 'hugo@sirreel.com' }))
check('an admin is not the billing desk either — inclusion is not seniority', !isBillingDesk({ role: 'ADMIN', email: 'wes@sirreel.com' }))

check('urgent-for-you outranks a tag, a tag outranks a waiting client', 
  chatTier({ urgentForMe: true, taggedMe: true, awaitingReply: true }) === 0
  && chatTier({ urgentForMe: false, taggedMe: true, awaitingReply: true }) === 1
  && chatTier({ urgentForMe: false, taggedMe: false, awaitingReply: true }) === 2
  && chatTier({ urgentForMe: false, taggedMe: false, awaitingReply: false }) === 3)
const quiet = (id: string, at: string) => ({ id, urgentForMe: false, taggedMe: false, awaitingReply: false, lastAt: new Date(at) })
check('newest first inside a tier, but a tag beats a newer quiet row', eq(
  sortChatRows([
    quiet('quiet-old', '2026-09-10T10:00Z'),
    quiet('quiet-new', '2026-09-17T10:00Z'),
    { id: 'tagged', urgentForMe: false, taggedMe: true, awaitingReply: false, lastAt: new Date('2026-09-01T10:00Z') },
  ]).map((r) => r.id),
  ['tagged', 'quiet-new', 'quiet-old'],
))
check('preview collapses whitespace', chatPreview('  a\n\n  b  ') === 'a b')
check('a long preview is cut with an ellipsis', (chatPreview('x'.repeat(400))).length === CHAT_PREVIEW_MAX && chatPreview('x'.repeat(400)).endsWith('…'))
check('no body = empty preview, never "undefined"', chatPreview(null) === '' && chatPreview(undefined) === '')

console.log('\n— waiting on us —')
const at = (s: string) => new Date(s)
check('no client message → not waiting', awaitingReply([{ kind: 'system', at: at('2026-09-12T10:00Z') }]) === false)
check('client wrote last → waiting', awaitingReply([{ kind: 'system', at: at('2026-09-12T10:00Z') }, { kind: 'client', at: at('2026-09-12T11:00Z') }]) === true)
check('we answered after → not waiting', awaitingReply([{ kind: 'client', at: at('2026-09-12T11:00Z') }, { kind: 'staff', at: at('2026-09-12T11:30Z') }]) === false)
check('order of rows does not matter', awaitingReply([{ kind: 'staff', at: at('2026-09-12T11:30Z') }, { kind: 'client', at: at('2026-09-12T11:00Z') }]) === false)

// ── Before a reply goes to the client: does it read like a note? ─────
console.log('\ninternalNoteTells — what the review step says out loud')
{
  const team = [
    { id: 'u-hugo', name: 'Hugo Ramirez' },
    { id: 'u-oliver', name: 'Oliver Carlson' },
    { id: 'u-ana', name: 'Ana Lopez' },
    { id: 'u-wes', name: 'Wes Bailey' },
  ]
  // Wes's two notes from SR-JOB-0312, 2026-09-17, as typed.
  const first = 'Hey team, there was some confusion about the start date for some reason. However it is picking up this morning early, supposedly at 6 am, so hopefully we can get that going as soon as possible. I believe Oliver may have already been all over this too @Hugo'
  const second = 'Hi all,\n\nI also noticed that she has a steel deck on this order but is only driving a pass van. How is that possible? @Oliver @Oliver @Oliver'
  const t1 = internalNoteTells(first, team)
  check('"Hey team … @Hugo": the mention is named', t1.some((t) => t.includes('@Hugo')), t1)
  check('"Hey team …": the opener is named', t1.some((t) => t.includes('Hey team')), t1)
  const t2 = internalNoteTells(second, team)
  check('"Hi all … @Oliver ×3": one mention line, one opener line', t2.length === 2 && t2[0].includes('@Oliver') && !t2[0].includes('@Oliver, @Oliver') && t2[1].includes('Hi all'), t2)

  check('a plain client reply has no tells', internalNoteTells('Hi Sarah,\n\nThe van is ready for pickup at 6 am tomorrow. Gate 1 code is in the after-hours email.\n\nThanks,\nJose', team).length === 0)
  check('"Hi all" to a production is still flagged — the review is loud, not blocking', internalNoteTells('Hi all, the trucks are confirmed for Monday.', team).some((t) => t.includes('Hi all')))
  check('a colleague addressed by name at a line start', internalNoteTells('Oliver, can you call her about the steel deck?', team).some((t) => t.includes('Oliver')))
  check('a first name mid-sentence is not an address', internalNoteTells('We told Oliver the van is set.', team).length === 0)
  check('"Ana" inside Anaheim does not trip', internalNoteTells('Anaheim, 6 am pickup confirmed.', team).length === 0)
  check('a client who shares a first name, mid-line, is fine', internalNoteTells('Please let Hugo at the production office know.', team).length === 0)
  check('an empty draft has no tells', internalNoteTells('   ', team).length === 0)
  check('no staff list → only the opener can tell', internalNoteTells('Hey team, @Hugo', []).length === 1)
}

console.log('\n— who the chip row offers —')
{
  // Wes 2026-09-17: these two come off the chips and stay reachable.
  const hidden = [
    { name: 'Greyson Bailey', email: 'greyson@sirreel.com' },
    { name: 'Tamra Bailey', email: 'tamra@sirreel.com' },
  ]
  check('the unlisted are off the chip row', hidden.every((p) => !isTagSuggested(p)))
  check('matched on the email when the name is spelled differently', !isTagSuggested({ name: 'G. Bailey', email: 'Greyson@SirReel.com' }))
  check('matched on the first name when the email is something else', !isTagSuggested({ name: 'Grayson Bailey', email: 'gb@sirreel.com' }))
  check('the spelling Wes typed and the one the account carries are both covered', MENTION_UNLISTED.includes('greyson') && MENTION_UNLISTED.includes('grayson'))
  check('everyone else is still offered', [
    { name: 'Jose Pacheco', email: 'jose@sirreel.com' },
    { name: 'Ana Ruiz', email: 'ana@sirreel.com' },
    { name: 'Wes Bailey', email: 'wes@sirreel.com' },
    { name: 'Hugo Ramirez', email: 'hugo@sirreel.com' },
  ].every(isTagSuggested))
  check('a name that merely contains a hidden one is untouched', isTagSuggested({ name: 'Tamrat Alemu', email: 'tamrat@sirreel.com' }))
  check('a missing email is not a match', isTagSuggested({ name: 'Julian Diaz', email: null }))
  // The capability Wes asked to keep: typed by hand, they still tag.
  const team = [{ id: 'u-greyson', name: 'Greyson Bailey' }, { id: 'u-jose', name: 'Jose Pacheco' }]
  check('an unlisted person is still tagged when typed', eq(mentionsIn('@Greyson can you call the yard?', team), ['u-greyson']))
  check('and still trips the client-reply warning', internalNoteTells('@Greyson heads up', team).length > 0)
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
