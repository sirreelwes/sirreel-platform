/**
 * HQ escalation routing.  npm run test:hq-escalation
 *
 * Wes, 2026-09-01, on who hears about what: "if it's related to needed
 * paperwork or delivery instructions or something between the client and
 * SirReel, the notifications should email sales and admin. If it's
 * something related to prepping a vehicle it should notify Hugo and
 * Julian, and if it's strictly related to orders that are going out, it
 * would be hugo and warehouse."
 *
 * The failure this guards is not a crash — it is a desk being sent work
 * it cannot do, which is how an alert channel becomes wallpaper.
 */

import {
  BLOCKER_DESK, COMMITTED_ORDER_STATUSES, DESK_CHANNEL, MAX_OVERDUE_DAYS,
  escalationTier, needsStaging, routeBlockers, TIER_RANK, withinEscalationWindow,
} from '../../src/lib/notifications/hqEscalation'
import { isNotificationChannelKey } from '../../src/lib/email/notificationChannels'

const failures: string[] = []
const check = (c: boolean, why: string) => {
  console.log(c ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!c) failures.push(why)
}

console.log('Everything the CLIENT owes us goes to sales & admin')
for (const b of ['coi', 'sign', 'card', 'driver'] as const) {
  check(BLOCKER_DESK[b] === 'client-facing', `${b} is chased by sales`)
}

console.log('\nWhat only fleet can do goes to fleet')
check(BLOCKER_DESK.gear === 'fleet-prep', 'gear — assigning a unit — is Hugo & Julian')

console.log('\nA desk with nothing to do is not emailed at all')
{
  const only = routeBlockers(['coi', 'sign'])
  check(only.has('client-facing'), 'a paperwork-only job reaches sales')
  check(!only.has('fleet-prep'), 'and NOT fleet — an alert they cannot act on is how a channel dies')
}
{
  const only = routeBlockers(['gear'])
  check(only.has('fleet-prep') && !only.has('client-facing'), 'a gear-only job reaches fleet alone')
}
{
  const both = routeBlockers(['coi', 'gear', 'card'])
  check(both.get('client-facing')?.join(',') === 'coi,card', 'a mixed job splits — sales get coi + card')
  check(both.get('fleet-prep')?.join(',') === 'gear', 'and fleet get only gear')
}
check(routeBlockers([]).size === 0, 'a ready job emails nobody')

console.log('\nTiers escalate toward pickup, and stay quiet before that')
check(escalationTier(-1) === 'overdue', 'yesterday is overdue')
check(escalationTier(0) === 'today', 'today')
check(escalationTier(1) === 'urgent' && escalationTier(2) === 'urgent', '1–2 days is urgent')
check(escalationTier(3) === 'soon' && escalationTier(6) === 'soon', '3–6 days is soon')
check(escalationTier(7) === null, 'a week out is NOT escalated — a COI three weeks early is a to-do, not an alarm')
check(escalationTier(90) === null, 'nor is three months out')
check(escalationTier(null) === null, 'a job with no pickup date raises nothing')
check(TIER_RANK.overdue < TIER_RANK.today && TIER_RANK.today < TIER_RANK.urgent && TIER_RANK.urgent < TIER_RANK.soon,
  'ranks sort most-urgent first')

console.log('\nOrders going out — the warehouse half')
check(needsStaging('DRAFT'), 'a DRAFT list is unstaged — that is what book-time creates, and all 19 live lists are DRAFT')
check(needsStaging('PICKING'), 'mid-pick is unstaged')
check(needsStaging('READY_TO_STAGE'), 'ready-to-stage is still not staged')
check(!needsStaging('STAGED'), 'STAGED is done')
check(!needsStaging('LOADED'), 'LOADED is past done')
check(!needsStaging('CHECKED_IN'), 'so is a returned list')
check(!needsStaging('CANCELLED'), 'a cancelled list is not going out')
check(needsStaging(null),
  'a MISSING pick list counts as unstaged — an order nobody started is not a fine one, and reading absence as OK is how it ships empty')
check(needsStaging(undefined), 'undefined behaves the same as null')

console.log('\nThe floor is only asked to pull committed orders')
check(!COMMITTED_ORDER_STATUSES.includes('DRAFT'), 'a DRAFT order is not staged')
check(!COMMITTED_ORDER_STATUSES.includes('QUOTE_SENT'),
  'nor an unapproved quote — including these ran the first dry run to 28 orders, most going nowhere')
check(COMMITTED_ORDER_STATUSES.includes('APPROVED') && COMMITTED_ORDER_STATUSES.includes('BOOKED'),
  'approved and booked orders are')
check(COMMITTED_ORDER_STATUSES.includes('ON_JOB'), 'and one already out, so a missed pull still surfaces')
check(!COMMITTED_ORDER_STATUSES.includes('RETURNED') && !COMMITTED_ORDER_STATUSES.includes('CLOSED'),
  'finished orders are not')

console.log('\nThe window looks FORWARD — a pickup that already passed is not a chase')
check(withinEscalationWindow(6), '6 days out is the far edge')
check(withinEscalationWindow(3), '3 days out is in')
check(withinEscalationWindow(0), 'today is')
check(MAX_OVERDUE_DAYS === 1, 'the overdue floor is one day')
check(withinEscalationWindow(-1),
  'yesterday still counts — a pickup that slipped one day is fixable this morning')
check(!withinEscalationWindow(-2),
  'two days past is not. Wes on the first preview: "why are emails in this list that would have started 5 days ago"')
check(!withinEscalationWindow(-5), 'nor five — that is a closeout, and the rail carries it as Not returned')
check(!withinEscalationWindow(-714),
  'and certainly not the mistyped 2024 date on S260831-005 that led the very first dry run')
check(!withinEscalationWindow(7), 'a week out is still too early to escalate')
check(!withinEscalationWindow(null), 'no date, no escalation')

console.log('\nEvery desk routes to a channel that actually exists')
for (const desk of ['client-facing', 'fleet-prep', 'staging'] as const) {
  const key = DESK_CHANNEL[desk]
  check(isNotificationChannelKey(key),
    `${desk} -> "${key}" is a registered channel, so /admin/notifications can edit it`)
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll HQ-escalation tests passed.')
process.exitCode = failures.length ? 1 : 0
