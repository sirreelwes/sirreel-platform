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
  BLOCKER_DESK, DESK_CHANNEL, escalationTier, routeBlockers, TIER_RANK,
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

console.log('\nBoth desks route to channels that actually exist')
for (const desk of ['client-facing', 'fleet-prep'] as const) {
  const key = DESK_CHANNEL[desk]
  check(isNotificationChannelKey(key),
    `${desk} -> "${key}" is a registered channel, so /admin/notifications can edit it`)
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll HQ-escalation tests passed.')
process.exitCode = failures.length ? 1 : 0
