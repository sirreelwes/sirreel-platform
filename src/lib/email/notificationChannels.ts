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
  | 'client-created-jobs'
  | 'hq-documents'
  | 'portal-card-trouble'
  | 'sales-team-cc'
  | 'signed-contract-sales'
  | 'signed-contract-billing'
  | 'invoice-billing-cc'
  | 'coi-team'
  | 'pickup-picklists'
  | 'warehouse-pull-orders'
  | 'daily-brief'
  | 'rw-token'
  | 'hq-escalation-sales'
  | 'hq-escalation-fleet'
  | 'hq-escalation-warehouse'
  | 'eod-collections'
  | 'eod-unassigned-units'
  | 'portal-opens'
  | 'portal-people'
  | 'portal-cards'
  | 'vendor-portal'
  | 'sub-rental-conduit-cc'
  | 'driver-checkouts'
  | 'driver-returns'

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
    key: 'client-created-jobs',
    label: 'Client-created jobs',
    description:
      'A client set up their own Job, Order and portal on the public rental-agreement page, with no agent involved — sometimes signing the agreement against an unpriced draft. One email per job with the dates, whether they signed, and who owns it. Sent the moment it happens during business hours (lot hours: weekdays 6am-6pm, Sat 7am-3:30pm); anything that arrives while we are closed is held and sent at 7am the next business day, so nobody is pinged at 2am and nothing is lost overnight (Wes 2026-09-08). Goes to the sales desk at rentals@ rather than the hq@ feed — this one needs someone to pick it up and quote it, not just to be seen (Wes 2026-09-08).',
    defaults: () => ['rentals@sirreel.com'],
  },
  {
    key: 'driver-returns',
    label: 'Driver self returns',
    description:
      'A driver on an UNATTENDED (blind) return dropped the vehicle and filed their own return photos, mileage and fuel from their driver page — nobody from SirReel received it. One email per drop with the readings, the miles driven, the photo count, whether the driver reported new damage, and a link to the side-by-side report. The yard still does its own walk-around; this is the heads-up that the truck is back and what to compare against. Defaults to the hq@ feed plus Wes (Wes 2026-09-07).',
    defaults: () => [hqNotifyInbox(), 'wes@sirreel.com'],
  },
  {
    key: 'driver-checkouts',
    label: 'Driver self check-outs',
    description:
      'A driver on an UNATTENDED (blind) pickup photographed the vehicle and checked it out from their driver page — nobody from SirReel was there. One email per check-out with the mileage, the photo count, whether the driver reported existing damage, whether their licence has been checked yet, and a link to the condition report. Defaults to the hq@ feed plus Wes (Wes 2026-09-05).',
    defaults: () => [hqNotifyInbox(), 'wes@sirreel.com'],
  },
  {
    key: 'vendor-portal',
    label: 'Partner portal activity',
    description:
      'A partner did something on their account page that needs a human: proposed new rates on a unit (nothing changes until you accept), updated their contact details, or signed the partner agreement. Defaults to the hq@ feed.',
    defaults: () => [hqNotifyInbox()],
  },
  {
    key: 'sub-rental-conduit-cc',
    label: 'Sub-rental conduit CC',
    description:
      'Copied on every email the sub-rental conduit sends between a production, a partner (King Kong etc.) and the partner\'s driver: location and call time going out, a driver being named, the driver confirming, the partner confirming or declining a hold, a driver\'s question. Wes 2026-09-05: "cc Wes on all of these emails for the time being" — so this defaults to Wes alone. Save an empty list here to stop the copies once the flow has proven itself.',
    defaults: () => ['wes@sirreel.com'],
  },
  {
    key: 'portal-opens',
    label: 'Portal first opens',
    description:
      'One email the FIRST time a client opens a portal we sent them — a job paperwork portal, or an executive\'s company portal. Never repeats for the same person and portal (Wes 2026-09-05: "send the first open alert to hq"). Defaults to the hq@ feed.',
    defaults: () => [hqNotifyInbox()],
  },
  {
    key: 'portal-people',
    label: 'Client-added portal access',
    description:
      'One email when a client adds a colleague to their own company portal from inside it (Wes 2026-09-06: "if she wants to add people she can do so in her portal"). Says who added whom, so the desk knows a new name is looking at the account before that person ever writes in. Defaults to the hq@ feed.',
    defaults: () => [hqNotifyInbox()],
  },
  {
    key: 'portal-cards',
    label: 'Client-added cards on file',
    description:
      'One email when a production company puts a card on file from its own account portal, or their bank refuses the verification while they try (Wes 2026-09-11: an accounting seat should be able to put a card down once for every show). Names the company, the person and the last four. Defaults to the hq@ feed.',
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
    key: 'warehouse-pull-orders',
    label: 'Warehouse pull orders',
    description:
      'A single order sent to the floor from its page in HQ — "pull this". The pull sheet is ATTACHED as a PDF rather than linked, because during the transition the people pulling do not all have HQ logins and the floor still works on paper. Carries the rep’s note and names any paperwork still outstanding. Defaults to warehouse@sirreel.com (Wes, 2026-09-09).',
    // Wes, 2026-09-09: "during the transition, pull list pdfs should be
    // sent to warehouse@sirreel.com for them to pull." A channel rather
    // than a hardcoded address so it can move without a deploy — but the
    // DEFAULT is the address he named, so it is right on day one with
    // nothing configured.
    defaults: () => ['warehouse@sirreel.com'],
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
