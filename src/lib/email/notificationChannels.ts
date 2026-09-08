/**
 * Notification channels — who receives each class of internal HQ email.
 *
 * Built for /admin/notifications (Wes 2026-08-31: "build the admin page
 * for managing notification recipients"). Before this, the audiences
 * were scattered across two Google Groups (hq@, rentals@), two env vars
 * (HQ_NOTIFY_INBOX and the since-removed TEAM_INBOX_EMAIL) and two
 * hardcoded rosters
 * (COPY_RECIPIENTS, COI_TEAM_INBOX) — controllable only from Google
 * Workspace admin or a deploy.
 *
 * Resolution order, per channel:
 *   1. NotificationChannel row (admin override) — its `emails` list is
 *      the WHOLE audience; an empty list deliberately silences the
 *      channel (meaningful for CC-type channels).
 *   2. No row → the channel's built-in default below.
 *
 * The resolver NEVER throws: these feed fire-and-forget notification
 * sends where a DB hiccup must degrade to the defaults, not kill the
 * email (or the request around it).
 *
 * ── The quiet-down pass (Wes 2026-09-08) ──────────────────────────────
 * "Everyone is getting way too many emails and we need to dial back so
 * that no one gets anything but absolutely necessary emails. Wes wants
 * to continue getting all HQ emails, but the guys don't need them."
 *
 * The cause was not the number of channels — it was that most of them
 * defaulted to a GROUP address. hq@ fans out to Wes, Jose and Oliver;
 * rentals@ fans out to Jose, Oliver and Dani. So every portal open,
 * every driver photo set, every signed PDF, every quote we sent, twice
 * a day the brief, landed in three or four inboxes whether or not any
 * of those people could do anything about it.
 *
 * So every channel now declares a `tier`, and the tier decides the
 * default audience:
 *
 *   'owner' — awareness. Nobody has to act on it, or the person who
 *             acts on it works it inside HQ rather than out of an
 *             inbox. Defaults to Wes ALONE. This is where the volume
 *             went; it is also why Wes still sees everything.
 *
 *   'desk'  — someone other than Wes has to DO something, and email is
 *             how they find out. That desk stays on the channel, and
 *             Wes is added to it. These are the "absolutely necessary"
 *             ones.
 *
 * Two rules for whoever edits this next:
 *   · A new channel is 'owner' unless you can name the person who is
 *     expected to act on it and say what they do. "They should probably
 *     know" is the definition of the tier that goes to Wes.
 *   · Prefer an individual or a small list over a group address. A
 *     group is invisible from here — you cannot tell from this file who
 *     hq@ reaches, and that is how three people ended up on everything.
 *
 * Group addresses still work fine as entries — an override list can be
 * ['hq@sirreel.com'] or individual people; the channel doesn't care.
 * The tier is documentation and a default, not a runtime restriction:
 * an admin override at /admin/notifications is still the whole audience
 * and still wins.
 */

import { prisma } from '@/lib/prisma'
import { COPY_RECIPIENTS, hqNotifyInbox, ownerNotifyInbox } from '@/lib/email/copyRecipients'

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
  | 'daily-brief'
  | 'rw-token'
  | 'rw-sync-failure'
  | 'hq-escalation-sales'
  | 'hq-escalation-fleet'
  | 'hq-escalation-warehouse'
  | 'eod-collections'
  | 'eod-unassigned-units'
  | 'portal-opens'
  | 'portal-people'
  | 'vendor-portal'
  | 'sub-rental-conduit-cc'
  | 'driver-checkouts'
  | 'driver-returns'
  | 'stale-inquiries'
  | 'fleet-readiness'
  | 'after-hours-access'
  | 'payment-info-requests'
  | 'stage-contract-prep'

/**
 * 'desk' = somebody other than Wes must act on it and email is how they
 * learn; 'owner' = awareness, Wes alone. See the header.
 */
export type NotificationTier = 'desk' | 'owner'

export interface NotificationChannelDef {
  key: NotificationChannelKey
  label: string
  /** What lands in these inboxes — shown on the admin page. */
  description: string
  tier: NotificationTier
  /**
   * Why this tier — one line, shown on the admin page next to the
   * badge. For 'desk' it must name who acts and what they do.
   */
  tierReason: string
  /** Built-in default audience. */
  defaults: () => string[]
}

export const NOTIFICATION_CHANNELS: NotificationChannelDef[] = [
  // ── desk: someone has to act ────────────────────────────────────────
  {
    key: 'client-created-jobs',
    label: 'Client-created jobs',
    description:
      'A client set up their own Job, Order and portal on the public rental-agreement page, with no agent involved — sometimes signing the agreement against an unpriced draft. One email per job with the dates, whether they signed, and who owns it. Sent the moment it happens during business hours (lot hours: weekdays 6am-6pm, Sat 7am-3:30pm); anything that arrives while we are closed is held and sent at 7am the next business day, so nobody is pinged at 2am and nothing is lost overnight (Wes 2026-09-08).',
    tier: 'desk',
    tierReason:
      'The sales desk has to price and quote it — an unworked client-created job is a booking nobody is on.',
    defaults: () => ['rentals@sirreel.com', ownerNotifyInbox()],
  },
  {
    key: 'portal-card-trouble',
    label: 'Client stuck on the card form',
    description:
      'Fires WHILE a client is failing to authorize their card in the portal — a card the tokenizer keeps refusing, or a $0 check the bank declined. Not a digest: a card is usually needed same or next day (Wes 2026-09-03), so this goes out within a minute of the trouble, at most once an hour per client.',
    tier: 'desk',
    tierReason: 'Someone has to pick up the phone while the client is still sitting on the form.',
    defaults: () => ['rentals@sirreel.com', ownerNotifyInbox()],
  },
  {
    key: 'after-hours-access',
    label: 'After-hours lot access',
    description:
      'A driver asked the assistant for after-hours access to the lot and was granted or DENIED it — with which identity factors matched (job code, VIN last-4, driver name) and the IP. On-call is texted separately; this is the written record and the backstop if the text does not land.',
    tier: 'desk',
    tierReason:
      'A driver is standing at a gate at night — whoever is on call has to answer, and it is not going to be Wes every time.',
    defaults: () => ['rentals@sirreel.com', ownerNotifyInbox()],
  },
  {
    key: 'hq-escalation-sales',
    label: 'HQ escalation — client-facing',
    description:
      'Rising alerts for work SirReel booked in HQ (not imported from Planyo or RentalWorks) that is approaching pickup while the CLIENT still owes us something: a COI, a signature, a card on file, or the name of whoever is driving. Silent until a job is inside 6 days of pickup.',
    tier: 'desk',
    tierReason: 'Chasing the client for the missing piece is the sales desk’s work.',
    defaults: () => ['rentals@sirreel.com', ownerNotifyInbox()],
  },
  {
    key: 'hq-escalation-fleet',
    label: 'HQ escalation — vehicle prep',
    description:
      'The same escalation, for the half only fleet can clear: an HQ-booked job approaching pickup with booking items that have no unit assigned. Deliberately separate from the client-facing list — a desk that gets alerts it cannot act on stops reading them.',
    tier: 'desk',
    tierReason: 'Hugo and Julian assign the unit; nobody else can clear this.',
    defaults: () => ['hugo@sirreel.com', 'julian@sirreel.com', ownerNotifyInbox()],
  },
  {
    key: 'hq-escalation-warehouse',
    label: 'HQ escalation — orders going out',
    description:
      'The floor half: HQ-booked orders approaching pickup whose pick list is still DRAFT / PICKING / READY_TO_STAGE — or missing entirely, which is an order nobody has started rather than one that is fine.',
    tier: 'desk',
    tierReason: 'Hugo’s floor starts the pick list. Point this at the warehouse once they have logins.',
    defaults: () => ['hugo@sirreel.com', ownerNotifyInbox()],
  },
  {
    key: 'pickup-picklists',
    label: 'Pick-up pick lists',
    description:
      'The day-before digest, weekday afternoons: jobs picking up tomorrow with all paperwork and approvals complete, each with a link to print its warehouse pick list — plus a heads-up list of pickups that are NOT ready. Friday’s run covers the weekend and Monday. A short-term bridge until picking is fully digital.',
    tier: 'desk',
    tierReason: 'It is the sheet the floor prints and picks from tomorrow morning.',
    defaults: () => ['hugo@sirreel.com', ownerNotifyInbox()],
  },
  {
    key: 'fleet-readiness',
    label: 'Fleet readiness reminder',
    description:
      'Daily early-AM digest of vehicles with assignments departing today or tomorrow, each line linking to its pre-rental inspection checkout page. Also posts to #fleet in Slack. Only sends when FLEET_REMINDERS_ENABLED is exactly "true"; otherwise the cron logs the payload instead.',
    tier: 'desk',
    tierReason: 'Fleet does the pre-rental inspection on these units before they roll.',
    defaults: () => ['hugo@sirreel.com', 'julian@sirreel.com', ownerNotifyInbox()],
  },
  {
    key: 'signed-contract-billing',
    label: 'Signed contracts — billing copies',
    description: 'Billing copied on signed rental agreements and stage contracts, with the PDF.',
    tier: 'desk',
    tierReason: 'Ana invoices against the signed terms — she needs the executed copy, not a summary.',
    defaults: () => [...COPY_RECIPIENTS.billing, ownerNotifyInbox()],
  },
  {
    key: 'invoice-billing-cc',
    label: 'Invoices — billing copy',
    description:
      'CC’d on every invoice that goes to a client: the invoice itself with its PDF, the pre-invoice review copy, the recorded final invoice with payment options, and the 14-day payment reminder. Billing already answers the replies — this makes the outbound send visible too, at the moment it leaves, so nobody chases an invoice twice.',
    tier: 'desk',
    tierReason: 'Billing works the replies and the chase; they need to see the send.',
    defaults: () => ['billing@sirreel.com', ownerNotifyInbox()],
  },
  {
    key: 'payment-info-requests',
    label: 'Payment-info requests',
    description:
      'A client asked for our banking / remittance details from the public page — fires on every path (auto-sent, queued for review, or errored). NEVER contains the banking details themselves; reference only.',
    tier: 'desk',
    tierReason: 'A queued or errored request is money waiting on billing to release it.',
    defaults: () => ['billing@sirreel.com', ownerNotifyInbox()],
  },
  {
    key: 'eod-collections',
    label: 'End-of-day collections report',
    description:
      'The evening collections summary Ana sends from /collections: what came in by card and through RentalWorks, what was written today, open AR, and her note. Deliberately narrow: it carries the day’s money, not an operational heads-up.',
    tier: 'desk',
    tierReason: 'Wes 2026-09-02 — Dani reads the day’s money with him.',
    defaults: () => ['dani@sirreel.com', ownerNotifyInbox()],
  },

  // ── owner: awareness, Wes alone ─────────────────────────────────────
  {
    key: 'hq-documents',
    label: 'HQ notifications',
    description:
      'The main internal feed: public form submissions (rental intake, contact, supply requests, space inquiries), signed rental agreements with the PDF attached, client COI drops, client redlines arriving, negotiated agreements going back out for signature, and portal paperwork events.',
    tier: 'owner',
    tierReason:
      'The widest feed there was, and the reason hq@ felt like a firehose — it is the record of everything, which is exactly what Wes asked to keep and the guys asked to lose.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'daily-brief',
    label: 'Daily operations brief',
    description:
      'The twice-daily "what is coming up" email — 6am (today) and 5pm (tomorrow) Pacific. Going out, coming back, the next seven days, and anything still out past its return day, each linked into HQ.',
    tier: 'owner',
    tierReason:
      'Two a day to the whole hq@ group, and the same thing the dispatch and jobs boards show live. Add a name back here only if they ask for it.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'sales-team-cc',
    label: 'Sales team CC',
    description:
      'Copied on client-facing sales email so the send is visible: quotes, quick replies, card-authorization requests, and sub-rental estimates. An empty list turns the CC off entirely.',
    tier: 'owner',
    tierReason:
      'Wes 2026-09-08 — this was one copy per outbound client email to the whole desk, the single biggest source of team mail. It was always a transition measure until the team worked in HQ; the send is on the order either way.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'signed-contract-sales',
    label: 'Signed contracts — sales copies',
    description: 'Sales copied on signed rental agreements and stage contracts.',
    tier: 'owner',
    tierReason:
      'A signature is not a task — the job page shows it, and the agent who sent it is on the thread already.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'coi-team',
    label: 'COI uploads',
    description:
      'The certificate itself when a client uploads a COI through the public COI link (in addition to HQ notifications).',
    tier: 'owner',
    tierReason:
      'COIs are reviewed at the COI desk in HQ (approve / reject / re-run AI), not out of an inbox.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'portal-opens',
    label: 'Portal first opens',
    description:
      'One email the FIRST time a client opens a portal we sent them — a job paperwork portal, or an executive’s company portal. Never repeats for the same person and portal.',
    tier: 'owner',
    tierReason: 'Pure signal that a link landed. Nothing to do about it.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'portal-people',
    label: 'Client-added portal access',
    description:
      'One email when a client adds a colleague to their own company portal from inside it. Says who added whom, so the desk knows a new name is looking at the account before that person ever writes in.',
    tier: 'owner',
    tierReason: 'Context for when that name writes in, not a task.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'vendor-portal',
    label: 'Partner portal activity',
    description:
      'A partner did something on their account page: proposed new rates on a unit (nothing changes until you accept), updated their contact details, or signed the partner agreement.',
    tier: 'owner',
    tierReason: 'Proposed rates wait on an explicit accept in HQ — the email is not the mechanism.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'sub-rental-conduit-cc',
    label: 'Sub-rental conduit CC',
    description:
      'Copied on every email the sub-rental conduit sends between a production, a partner (King Kong etc.) and the partner’s driver: location and call time going out, a driver being named, the driver confirming, the partner confirming or declining a hold, a driver’s question.',
    tier: 'owner',
    tierReason:
      'Wes 2026-09-05: "cc Wes on all of these emails for the time being." Save an empty list here once the flow has proven itself.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'driver-checkouts',
    label: 'Driver self check-outs',
    description:
      'A driver on an UNATTENDED (blind) pickup photographed the vehicle and checked it out from their driver page — nobody from SirReel was there. One email per check-out with the mileage, the photo count, whether the driver reported existing damage, whether their licence has been checked yet, and a link to the condition report.',
    tier: 'owner',
    tierReason: 'The condition report is in HQ; the email is the heads-up that it exists.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'driver-returns',
    label: 'Driver self returns',
    description:
      'A driver on an UNATTENDED (blind) return dropped the vehicle and filed their own return photos, mileage and fuel from their driver page. One email per drop with the readings, the miles driven, the photo count, whether the driver reported new damage, and a link to the side-by-side report.',
    tier: 'owner',
    tierReason:
      'The yard does its own walk-around regardless — this is the heads-up that the truck is back, not the inspection.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'stale-inquiries',
    label: 'Stale inquiry digest',
    description:
      'Inbound inquiries still sitting NEW past the staleness window, once per inquiry — not every hour — until one is worked or its alert is dismissed. Links into the incoming queue on /jobs.',
    tier: 'owner',
    tierReason:
      'The incoming queue on /jobs is the live version of this list and the desk already lands there.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'eod-unassigned-units',
    label: 'End-of-day: units not assigned',
    description:
      'Quotes sent with vehicles held but no specific unit picked, mailed at 5pm Pacific (Wes 2026-09-03). A quote reserves a CATEGORY — until someone picks the truck it sits on no unit row, and the same vehicle can go out twice. Silent on a day with nothing outstanding.',
    tier: 'owner',
    tierReason:
      'Already Wes-only by default. The unit-prep half of this reaches fleet through the vehicle-prep escalation.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'stage-contract-prep',
    label: 'Stage contract asked for but not prepared',
    description:
      'A client tried to sign a stage contract from the public site on a job that has no contract prepared yet. The job’s own agent is always the primary recipient; this channel is the copy that stops the request dying in one agent’s inbox while they are on location.',
    tier: 'owner',
    tierReason:
      'The agent on the job is mailed directly and owns it — this list is only the backstop copy.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'rw-token',
    label: 'RentalWorks connection',
    description:
      'The RentalWorks token failed to renew, failed to verify, or has been red for a day.',
    tier: 'owner',
    tierReason: 'Renewing the credential is an admin job — widen it here if someone else can fix it.',
    defaults: () => [ownerNotifyInbox()],
  },
  {
    key: 'rw-sync-failure',
    label: 'RentalWorks sync failing',
    description:
      'A RentalWorks mirror (invoice, quote or order-ref) failed to sync, so the balances Collections / Receivables / Reconcile show are stale and should not be quoted to a client. De-duplicated per calendar day, and raised as an Action-Queue alert as well.',
    tier: 'owner',
    tierReason:
      'Same admin hands as the token above — this used to go to the whole hq@ group, who could not fix it.',
    defaults: () => [ownerNotifyInbox()],
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

/**
 * hqNotifyInbox is no longer a channel default — the quiet-down pass
 * replaced every hq@ default with Wes. Re-exported so the one legitimate
 * remaining reader (a deliberate override typed into /admin/notifications)
 * and any future caller still resolve the group through one place, and so
 * the import above does not read as dead to whoever prunes next.
 */
export { hqNotifyInbox }
