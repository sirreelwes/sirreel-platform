/**
 * Utliiz by VerMar Design — the white-label product a SirReel partner can run
 * their own fleet on.
 *
 * Wes 2026-09-05: "start creating the white label HQ for vendors who use
 * our portal. Eventually we will add a link at the bottom that says 'See
 * what HQ can do for you' and we will have a simplified version of
 * SirReel's HQ that they can subscribe to — paying VerMar Design."
 *
 * Everything the product SAYS about itself lives here — its name, who
 * makes it, the trial length, the plans and the pitch — so the landing
 * page, the workspace shell and the emails can't drift apart. SirReel is
 * never named inside the product: a partner's HQ is theirs, and SirReel
 * is simply the client whose bookings flow in.
 */

export const HQ_PRODUCT = {
  /**
   * What the product is called. Wes 2026-09-06: "Utliiz" — coined from
   * utilization, the number every fleet owner watches; six letters, link-
   * shared, ownable (utliiz.com was free; "HQ", "360", "Gear", "EQ" and
   * "Utiliz" all collide with live software). Route paths (/hq/[token])
   * keep their old name on purpose — a rename there would kill every
   * link already handed out.
   */
  name: 'Utliiz',
  /** Who the subscription is paid to. */
  maker: 'VerMar Design',
  /** Wes 2026-09-06: the tagline is "Utliiz more…" — ellipsis included. */
  tagline: 'Utliiz more…',
  /** Free trial length, in days, from the moment a partner starts it. */
  trialDays: 30,
  /**
   * The accent a workspace wears until the partner picks their own — the
   * Utliiz turquoise (Wes 2026-09-06: the invoice-PDF teal, src/lib/pdf/
   * brand.ts `accent`). NOT SirReel's gold: nothing in a white label is ours.
   */
  defaultAccent: '#0F7A93',
  /** Where a partner writes when something is wrong. */
  supportEmail: 'hq@vermardesign.com',
  /**
   * The product's own origin — driver pages and other NEW links are minted
   * here (utliiz.com went live 2026-09-06). Workspace links still mint on
   * NEXT_PUBLIC_APP_URL until Wes says to move them.
   */
  origin: 'https://utliiz.com',
  /**
   * The ADDRESS driver mail is sent from (e.g. drivers@utliiz.com); the
   * display name is the partner's, composed per send — see
   * driverSenderFor(). Resend has to have utliiz.com verified for this to
   * leave; until then UTLIIZ_SEND_FROM is unset and mail goes out from
   * SirReel's notifications@ with the partner's name in the body.
   */
  sendFrom: process.env.UTLIIZ_SEND_FROM || null,
} as const

export type HqPlanKey = 'STARTER' | 'PRO'

export interface HqPlan {
  key: HqPlanKey
  name: string
  /**
   * Monthly price in USD. NULL = not announced — Wes has not set pricing
   * (2026-09-05). The landing page then says pricing is announced before
   * the trial ends rather than inventing a number.
   */
  monthlyUsd: number | null
  blurb: string
  includes: string[]
}

/**
 * Add-ons priced by use, on top of a plan. Wes 2026-09-06: "CRM adds
 * $10/mo per 500 contacts with a cap at $49/mo additional."
 */
export interface HqAddOn {
  key: string
  name: string
  blurb: string
  /** Per-block price and block size, and the monthly ceiling. */
  perBlockUsd: number
  blockSize: number
  blockNoun: string
  capUsd: number
}

export const HQ_ADD_ONS: HqAddOn[] = [
  {
    key: 'CRM',
    name: 'CRM',
    blurb: 'Every production and contact you\'ve ever worked with, who booked what, and follow-ups that don\'t fall through.',
    perBlockUsd: 10,
    blockSize: 500,
    blockNoun: 'contacts',
    capUsd: 49,
  },
]

export const HQ_PLANS: HqPlan[] = [
  {
    key: 'STARTER',
    name: 'Starter',
    // Wes 2026-09-06: "plans should start at $49/mo. That is just the basics."
    monthlyUsd: 49,
    blurb: 'One calendar for your whole fleet, your own bookings, your drivers.',
    includes: [
      'Fleet & rates',
      'Calendar across every unit',
      'Holds and bookings for your own productions',
      'Drivers: their own page, call times, hours and meters',
      'Bookings from your partners flow in automatically',
    ],
  },
  {
    key: 'PRO',
    name: 'Pro',
    monthlyUsd: null,
    blurb: 'Everything in Starter, plus the paperwork.',
    includes: [
      'Everything in Starter',
      'Quotes and rental agreements, signed online',
      'Driver pages with call times and hours',
      'Client-facing unit pages',
      'Invoicing',
    ],
  },
]

/**
 * The pitch on the "See what HQ can do for you" page — each block is a
 * thing the partner already does by phone, text and spreadsheet.
 */
export const HQ_PITCH: { title: string; body: string }[] = [
  {
    title: 'One calendar, every unit',
    body: 'Every trailer, truck and honeywagon on one grid, by day. Bookings from partners who rent your units land on it automatically, so a double-book shows up before it happens.',
  },
  {
    title: 'Your own bookings',
    body: 'Hold a unit for a production, confirm it, send it out, bring it back. The same four steps you run today, written down once, visible to everyone in your office.',
  },
  {
    title: 'Fleet & rates',
    body: 'Your whole roster, whether or not a partner can rent it. Day, week and month rates on each unit, and a record of every change.',
  },
  {
    title: 'Clients',
    body: 'The productions and companies that book you directly, with who to call and what they usually take.',
  },
  {
    title: 'Drivers, call times, hours',
    body: 'Name the driver on a booking, give them the call time and the address on their phone, and collect their hours the same way. (Pro)',
  },
  {
    title: 'Quotes and agreements',
    body: 'Quote a production from your rate card, get the rental agreement signed online, invoice at wrap. (Pro)',
  },
]

/** What the workspace shows in the trial banner and on the staff row. */
export function trialDaysLeft(trialEndsAt: Date | string | null): number | null {
  if (!trialEndsAt) return null
  const end = typeof trialEndsAt === 'string' ? new Date(trialEndsAt) : trialEndsAt
  return Math.ceil((end.getTime() - Date.now()) / 86_400_000)
}

/**
 * Where VerMar Design hears about its own customers — a trial started, a
 * partner writing in. NOT a SirReel notification channel: the partners'
 * subscriptions are VerMar's business (Wes 2026-09-05). VERMAR_OPS_EMAILS
 * replaces the default, which is Wes until VerMar has its own inbox.
 */
export function vermarOpsEmails(): string[] {
  const raw = process.env.VERMAR_OPS_EMAILS
  const list = raw ? raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : []
  return list.length ? list : ['wes@sirreel.com']
}
