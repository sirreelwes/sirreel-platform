/**
 * Notification channel audiences.  npm run test:channel-tiers
 *
 * Wes, 2026-09-08: "Everyone is getting way too many emails and we need
 * to dial back so that no one gets anything but absolutely necessary
 * emails. Wes wants to continue getting all HQ emails, but the guys
 * don't need them."
 *
 * The failure this guards is slow and invisible. Nothing breaks when a
 * channel quietly grows a recipient; the email just starts landing in
 * one more inbox, and eighteen months later hq@ is a firehose again and
 * nobody can point at the commit that did it. That is exactly how this
 * pass became necessary in the first place.
 *
 * So the rules are asserted rather than trusted:
 *   · Every channel declares a tier and argues for it.
 *   · 'owner' means Wes and only Wes — no group addresses, no extras.
 *   · 'desk' means Wes PLUS the desk that has to act.
 *   · Group addresses (hq@, fleet@, and the like) can only appear on a
 *     'desk' channel, because a group is a list you cannot read from
 *     here — hq@ was on nineteen channels before this pass and reached
 *     three people on every one of them.
 *
 * These are assertions about the DEFAULTS. An admin override typed at
 * /admin/notifications is still the whole audience and still wins; that
 * is a person making a decision, which is the point of the page.
 */

import {
  NOTIFICATION_CHANNELS,
  isNotificationChannelKey,
  dedupeEmails,
  type NotificationChannelDef,
} from '../../src/lib/email/notificationChannels'
import { ownerNotifyInbox } from '../../src/lib/email/copyRecipients'

const failures: string[] = []
const check = (c: boolean, why: string) => {
  console.log(c ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!c) failures.push(why)
}

const OWNER = ownerNotifyInbox().toLowerCase()
const lower = (d: NotificationChannelDef) => d.defaults().map((e) => e.trim().toLowerCase())

/**
 * A group / role address rather than a person. Not an exhaustive list of
 * our groups — it is the shape check: no local part that reads as a team
 * gets onto an awareness channel.
 */
const GROUPISH = new Set([
  'hq@sirreel.com', 'rentals@sirreel.com', 'fleet@sirreel.com',
  'info@sirreel.com', 'billing@sirreel.com', 'sales@sirreel.com',
  'box@sirreel.com', 'hello@sirreel.com',
])

console.log('Every channel is declared once and argues for its tier')
{
  const keys = NOTIFICATION_CHANNELS.map((c) => c.key)
  check(new Set(keys).size === keys.length, 'no duplicate channel keys')
  check(keys.every((k) => isNotificationChannelKey(k)), 'every key is in the exported union')
  for (const def of NOTIFICATION_CHANNELS) {
    check(
      def.tier === 'desk' || def.tier === 'owner',
      `${def.key} declares a tier`,
    )
    check(
      def.tierReason.trim().length > 20,
      `${def.key} says WHY it is '${def.tier}' — a tier with no argument is a tier nobody can push back on`,
    )
    check(def.description.trim().length > 0, `${def.key} describes what lands in the inbox`)
  }
}

console.log('\nWes is on everything — that was the one thing he asked to keep')
for (const def of NOTIFICATION_CHANNELS) {
  check(lower(def).includes(OWNER), `${def.key} includes ${OWNER}`)
}

console.log('\n"Wes only" means only Wes')
for (const def of NOTIFICATION_CHANNELS.filter((d) => d.tier === 'owner')) {
  const to = lower(def)
  check(
    to.length === 1 && to[0] === OWNER,
    `${def.key} is exactly [${OWNER}], not ${JSON.stringify(to)}`,
  )
}

console.log('\n"Needs action" reaches a desk as well as Wes')
for (const def of NOTIFICATION_CHANNELS.filter((d) => d.tier === 'desk')) {
  const to = lower(def)
  check(
    to.length >= 2,
    `${def.key} names someone besides Wes — otherwise it is an 'owner' channel wearing a 'desk' badge`,
  )
}

console.log('\nA group address can only appear where somebody has to act on it')
for (const def of NOTIFICATION_CHANNELS) {
  const groups = lower(def).filter((e) => GROUPISH.has(e))
  check(
    def.tier === 'desk' || groups.length === 0,
    `${def.key} (${def.tier}) does not default to a group${groups.length ? ` — found ${groups.join(', ')}` : ''}`,
  )
}

console.log('\nhq@ is off the defaults entirely — it was the firehose')
for (const def of NOTIFICATION_CHANNELS) {
  check(!lower(def).includes('hq@sirreel.com'), `${def.key} does not default to hq@sirreel.com`)
}

console.log('\nNo channel repeats a recipient (a dupe is two copies of one email)')
for (const def of NOTIFICATION_CHANNELS) {
  const raw = def.defaults()
  check(
    dedupeEmails(raw).length === raw.length,
    `${def.key} has no duplicate address`,
  )
}

console.log('\nEvery default is a deliverable address')
{
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  for (const def of NOTIFICATION_CHANNELS) {
    check(
      def.defaults().every((e) => EMAIL_RE.test(e.trim())),
      `${def.key} defaults parse as addresses`,
    )
  }
}

console.log(
  failures.length === 0
    ? `\nAll good — ${NOTIFICATION_CHANNELS.length} channels.`
    : `\n${failures.length} FAILURE(S):\n` + failures.map((f) => `  - ${f}`).join('\n'),
)
process.exit(failures.length === 0 ? 0 : 1)
