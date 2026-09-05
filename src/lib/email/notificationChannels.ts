/**
 * Notification channels — who receives each class of internal HQ email.
 *
 * Built for /admin/notifications (Wes 2026-08-31: "build the admin page
 * for managing notification recipients"). Before this, the audiences
 * were scattered across two Google Groups (hq@, rentals@), two env vars
 * (HQ_NOTIFY_INBOX, TEAM_INBOX_EMAIL) and two hardcoded rosters
 * (COPY_RECIPIENTS, COI_TEAM_INBOX) — controllable only from Google
 * Workspace admin or a deploy.
 *
 * Resolution order, per channel:
 *   1. NotificationChannel row (admin override) — its `emails` list is
 *      the WHOLE audience; an empty list deliberately silences the
 *      channel (meaningful for CC-type channels).
 *   2. No row → the channel's built-in default: the same env var /
 *      hardcoded roster it shipped with, so behavior is unchanged until
 *      someone edits it in the admin page.
 *
 * The resolver NEVER throws: these feed fire-and-forget notification
 * sends where a DB hiccup must degrade to the defaults, not kill the
 * email (or the request around it).
 *
 * Group addresses still work fine as entries — an override list can be
 * ['hq@sirreel.com'] or individual people; the channel doesn't care.
 */

import { prisma } from '@/lib/prisma'
import { COPY_RECIPIENTS, hqNotifyInbox } from '@/lib/email/copyRecipients'
import { teamInboxEmail } from '@/lib/email/teamVisibility'

export type NotificationChannelKey =
  | 'hq-documents'
  | 'portal-card-trouble'
  | 'sales-team-cc'
  | 'signed-contract-sales'
  | 'signed-contract-billing'
  | 'invoice-billing-cc'
  | 'coi-team'
  | 'pickup-picklists'
  | 'daily-brief'
  | 'rw-token'
  | 'hq-escalation-sales'
  | 'hq-escalation-fleet'
  | 'hq-escalation-warehouse'
  | 'eod-collections'
  | 'eod-unassigned-units'
  | 'portal-opens'

export interface NotificationChannelDef {
  key: NotificationChannelKey
  label: string
  /** What lands in these inboxes — shown on the admin page. */
  description: string
  /** Built-in default audience (env var / hardcoded roster). */
  defaults: () => string[]
}

export const NOTIFICATION_CHANNELS: NotificationChannelDef[] = [
  {
    key: 'portal-opens',
    label: 'Portal first opens',
    description:
      'One email the FIRST time a client opens a portal we sent them — a job paperwork portal, or an executive\'s company portal. Never repeats for the same person and portal (Wes 2026-09-05: "send the first open alert to hq"). Defaults to the hq@ feed.',
    defaults: () => [hqNotifyInbox()],
  },
  {
    key: 'hq-documents',
    label: 'HQ notifications',
    description:
      'The main internal feed: public form submissions (rental intake, contact, supply requests, space inquiries), signed rental agreements with the PDF attached, client COI drops, client redlines arriving, negotiated agreements going back out for signature, and portal paperwork events. Default is the hq@ distribution group — which Jose and Oliver already read.',
    defaults: () => [hqNotifyInbox()],
  },
  {
    key: 'portal-card-trouble',
    label: 'Client stuck on the card form',
    description:
      'Fires WHILE a client is failing to authorize their card in the portal — a card the tokenizer keeps refusing, or a $0 check the bank declined. Not a digest: a card is usually needed same or next day (Wes 2026-09-03), so this goes out within a minute of the trouble, at most once an hour per client. Point it at whoever can pick up the phone; defaults to the sales desk and Wes.',
    defaults: () => ['rentals@sirreel.com', 'wes@sirreel.com'],
  },
  {
    key: 'sales-team-cc',
    label: 'Sales team CC',
    description:
      'Copied on client-facing sales email so the whole desk sees what went out: quotes, quick replies, card-authorization requests, and sub-rental estimates. An empty list turns the CC off entirely. Default is the rentals@ group.',
    defaults: () => {
      const team = teamInboxEmail()
      return team ? [team] : []
    },
  },
  {
    key: 'signed-contract-sales',
    label: 'Signed contracts — sales copies',
    description:
      'Sales people copied on signed rental agreements and stage contracts.',
    defaults: () => [...COPY_RECIPIENTS.sales],
  },
  {
    key: 'signed-contract-billing',
    label: 'Signed contracts — billing copies',
    description: 'Billing people copied on signed rental agreements and stage contracts.',
    defaults: () => [...COPY_RECIPIENTS.billing],
  },
  {
    key: 'invoice-billing-cc',
    label: 'Invoices — billing copy',
    description:
      'CC\u2019d on every invoice that goes to a client: the invoice itself with its PDF, the pre-invoice review copy, the recorded final invoice with payment options, and the 14-day payment reminder. Billing already answers the replies \u2014 this makes the outbound send visible too, at the moment it leaves, so nobody chases an invoice twice. An empty list turns the copy off.',
    defaults: () => ['billing@sirreel.com'],
  },
  {
    key: 'coi-team',
    label: 'COI uploads',
    description:
      'Receives the certificate itself when a client uploads a COI through the public COI link (in addition to HQ notifications).',
    defaults: () => ['rentals@sirreel.com'],
  },
  {
    key: 'rw-token',
    label: 'RentalWorks connection',
    description:
      'The RentalWorks token failed to renew, failed to verify, or has been red for a day. Renewing the credential is an admin job rather than a billing one, so this defaults to Wes alone — widen it here if someone else should be able to fix it.',
    defaults: () => ['wes@sirreel.com'],
  },
  {
    key: 'daily-brief',
    label: 'Daily operations brief',
    description:
      'The twice-daily "what is coming up" email — 6am (today) and 5pm (tomorrow) Pacific. Going out, coming back, the next seven days, and anything still out past its return day, each linked into HQ. This is the widest internal list: it is meant for everyone who needs to know what is moving.',
    defaults: () => [hqNotifyInbox()],
  },
  {
    key: 'pickup-picklists',
    label: 'Pick-up pick lists',
    description:
      'The day-before digest, weekday afternoons: jobs picking up tomorrow with all paperwork and approvals complete, each with a link to print its warehouse pick list — plus a heads-up list of pickups that are NOT ready. Friday’s run covers the weekend and Monday. A short-term bridge until picking is fully digital.',
    defaults: () => [hqNotifyInbox()],
  },
  {
    key: 'hq-escalation-sales',
    label: 'HQ escalation — client-facing',
    description:
      'Rising alerts for work SirReel booked in HQ (not imported from Planyo or RentalWorks) that is approaching pickup while the CLIENT still owes us something: a COI, a signature, a card on file, or the name of whoever is driving. Sales and admin, because chasing a client is their work. Silent until a job is inside 6 days of pickup.',
    defaults: () => ['rentals@sirreel.com', 'wes@sirreel.com'],
  },
  {
    key: 'hq-escalation-fleet',
    label: 'HQ escalation — vehicle prep',
    description:
      'The same escalation, for the half only fleet can clear: an HQ-booked job approaching pickup with booking items that have no unit assigned. Hugo and Julian. Deliberately separate from the client-facing list — a desk that gets alerts it cannot act on stops reading them.',
    defaults: () => ['hugo@sirreel.com', 'julian@sirreel.com'],
  },
  {
    key: 'hq-escalation-warehouse',
    label: 'HQ escalation — orders going out',
    description:
      'The floor half: HQ-booked orders approaching pickup whose pick list is still DRAFT / PICKING / READY_TO_STAGE — or missing entirely, which is an order nobody has started rather than one that is fine. Hugo and the warehouse. There are no WAREHOUSE-role users yet, so the default is Hugo plus the hq@ group; point it at the floor once they have logins.',
    defaults: () => ['hugo@sirreel.com', hqNotifyInbox()],
  },
  {
    key: 'eod-unassigned-units',
    label: 'End-of-day: units not assigned',
    description:
      'Quotes sent with vehicles held but no specific unit picked, mailed at 5pm Pacific (Wes 2026-09-03). A quote reserves a CATEGORY — until someone picks the truck it sits on no unit row, and the same vehicle can go out twice. Silent on a day with nothing outstanding. Sales and dispatch both need it: sales sent the quote, dispatch picks the unit.',
    defaults: () => ['wes@sirreel.com'],
  },
  {
    key: 'eod-collections',
    label: 'End-of-day collections report',
    description:
      'The evening collections summary Ana sends from /collections: what came in by card and through RentalWorks, what was written today, open AR, and her note. Wes 2026-09-02 — Dani and Wes for now. Deliberately narrow: it carries the day\u2019s money, not an operational heads-up.',
    defaults: () => ['dani@sirreel.com', 'wes@sirreel.com'],
  },
]

const CHANNEL_BY_KEY = new Map(NOTIFICATION_CHANNELS.map((c) => [c.key, c]))

export function isNotificationChannelKey(key: string): key is NotificationChannelKey {
  return CHANNEL_BY_KEY.has(key as NotificationChannelKey)
}

/** The effective audience for a channel. Never throws — see module doc. */
export async function channelRecipients(key: NotificationChannelKey): Promise<string[]> {
  const def = CHANNEL_BY_KEY.get(key)
  if (!def) return []
  try {
    const row = await prisma.notificationChannel.findUnique({
      where: { key },
      select: { emails: true },
    })
    if (row) return row.emails
  } catch (err) {
    console.error(
      `[notificationChannels] lookup failed for ${key}, using defaults:`,
      err instanceof Error ? err.message : err,
    )
  }
  return def.defaults()
}

/** Case-insensitive dedupe for composing To/CC lines from several channels. */
export function dedupeEmails(emails: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of emails) {
    const norm = e.trim().toLowerCase()
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    out.push(e.trim())
  }
  return out
}
