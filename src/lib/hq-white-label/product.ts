/**
 * HQ by VerMar Design — the white-label product a SirReel partner can run
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
  /** What the product is called. Deliberately just "HQ". */
  name: 'HQ',
  /** Who the subscription is paid to. */
  maker: 'VerMar Design',
  tagline: 'Run your fleet from one place.',
  /** Free trial length, in days, from the moment a partner starts it. */
  trialDays: 30,
  /**
   * The neutral accent a workspace wears until the partner picks their own.
   * NOT SirReel's gold — the point of a white label is that nothing in it
   * is ours.
   */
  defaultAccent: '#1f3a5f',
  /** Where a partner writes when something is wrong. */
  supportEmail: 'hq@vermardesign.com',
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

export const HQ_PLANS: HqPlan[] = [
  {
    key: 'STARTER',
    name: 'Starter',
    monthlyUsd: null,
    blurb: 'One calendar for your whole fleet, your own bookings, your clients.',
    includes: [
      'Fleet & rates',
      'Calendar across every unit',
      'Holds and bookings for your own productions',
      'Client list',
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
