/**
 * Spectiv by VerMar Design — the software-as-a-service plan: a version of
 * SirReel's HQ, cut down and tailor-made to work with the SirReel.com
 * marketplace, that people in the industry subscribe to and run on their
 * own.
 *
 * Wes 2026-09-05: "start creating the white label HQ for vendors who use
 * our portal. Eventually we will add a link at the bottom that says 'See
 * what HQ can do for you' and we will have a simplified version of
 * SirReel's HQ that they can subscribe to — paying VerMar Design."
 *
 * Wes 2026-09-19: "Instead of utiliiz.com we are switching the
 * software-as-a-service plan to spectiv.pro. Spectiv is software that will
 * support people in the industry and give them a version of SirReel's HQ
 * that is tailor-made to work with SirReel.com's marketplace. It will
 * provide them with lots of services that they can use on their own. I
 * just don't want to give all of our skills to our competitors."
 *
 * Everything the product SAYS about itself lives here — its name, who
 * makes it, the trial length, the plans and the pitch — so the landing
 * page, the workspace shell and the emails can't drift apart. Since the
 * 9/19 switch the SirReel.com MARKETPLACE is named openly — it is the
 * point of the product — but the product stays the trimmed version: the
 * skills that make SirReel's client service (the full HQ) are not in it.
 */

/**
 * Whether SirReel's partners are OFFERED Spectiv at all.
 *
 * Wes 2026-09-11 (about Utliiz, as it was then called): "remove the Utliiz links from all communication for now.
 * I think we are going to focus on using this tech to aggregate partners
 * into our sales and take a smaller piece… I don't want them to have the
 * tech so they can't compete with our client service."
 *
 * FALSE closes every partner-side door in one place: the strip on the
 * partner account page, the "See what Spectiv can do for you" landing page,
 * the start-trial route, and the workspace shell itself (a VerMar operator's
 * support view still opens). The product code stays; flipping this back on
 * restores all of it without a rebuild of anything else.
 */
export const PARTNER_HQ_OFFER = false

export const HQ_PRODUCT = {
  /**
   * What the product is called. Wes 2026-09-19: "Spectiv" (spectiv.pro) —
   * replaces "Utliiz" (Wes 2026-09-06, coined from utilization; utliiz.com
   * still resolves here and redirects). Route paths (/hq/[token]) keep
   * their old name on purpose — a rename there would kill every link
   * already handed out.
   */
  name: 'Spectiv',
  /** Who the subscription is paid to. */
  maker: 'VerMar Design',
  /**
   * The line under the mark. "Utliiz more…" was a pun on the old name and
   * went with it; this is the first draft for Spectiv, not Wes's words —
   * he has not set one yet.
   */
  tagline: 'Your fleet, in perspective.',
  /** Free trial length, in days, from the moment a partner starts it. */
  trialDays: 30,
  /**
   * The accent a workspace wears until the partner picks their own — the
   * Spectiv turquoise (Wes 2026-09-06: the invoice-PDF teal, src/lib/pdf/
   * brand.ts `accent`). NOT SirReel's gold: nothing in a white label is ours.
   */
  defaultAccent: '#0F7A93',
  /** Where a partner writes when something is wrong. */
  supportEmail: 'hq@vermardesign.com',
  /**
   * The product's own origin — driver pages and other NEW links are minted
   * here. spectiv.pro is registered (Cloudflare) but as of 2026-09-19 has
   * no DNS record and is not attached to the Vercel project, so a link
   * minted there would be dead: until SPECTIV_PRO_LIVE=1 is set in Vercel
   * (Wes, once DNS + the domain attachment are done) new links keep
   * minting on utliiz.com, which is attached and serving. The same flag
   * turns on the utliiz.com → spectiv.pro redirect in the middleware, so
   * the two never disagree about which domain is real. Workspace links
   * still mint on NEXT_PUBLIC_APP_URL until Wes says to move them.
   */
  origin: process.env.SPECTIV_PRO_LIVE === '1' ? 'https://spectiv.pro' : 'https://utliiz.com',
  /**
   * The ADDRESS driver mail is sent from (e.g. dispatch@spectiv.pro); the
   * display name is the partner's, composed per send — see
   * driverSenderFor(). Resend has to have the domain verified for this to
   * leave. SPECTIV_SEND_FROM wins; UTLIIZ_SEND_FROM (dispatch@utliiz.com,
   * verified 2026-09-06, set in Vercel Production) still carries mail until
   * spectiv.pro is verified at Resend and the new var is set — nothing
   * about the switch may silently push driver mail back onto SirReel's
   * sender. Unset both and mail goes out from SirReel's notifications@.
   */
  sendFrom: process.env.SPECTIV_SEND_FROM || process.env.UTLIIZ_SEND_FROM || null,
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
    blurb: 'One calendar for your whole fleet, your marketplace bookings, your own bookings, your drivers.',
    includes: [
      'Fleet & rates',
      'Calendar across every unit',
      'Holds and bookings for the jobs you book direct',
      'Drivers: their own page, call times, hours and meters',
      'Bookings from the SirReel.com marketplace flow in automatically',
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
 * The pitch on spectiv.pro — each block is a thing a fleet office already
 * does by phone, text and spreadsheet. The full HQ (quotes, client
 * service, collections) is deliberately not the pitch (Wes 2026-09-19:
 * "I just don't want to give all of our skills to our competitors").
 */
export const HQ_PITCH: { title: string; body: string }[] = [
  {
    title: 'One calendar, every unit',
    body: 'Every trailer, truck and honeywagon on one grid, by day. Bookings of your units through the SirReel.com marketplace land on it automatically, so a double-book shows up before it happens.',
  },
  {
    title: 'Your own bookings',
    body: 'Hold a unit for a production, confirm it, send it out, bring it back. The same four steps you run today, written down once, visible to everyone in your office.',
  },
  {
    title: 'Fleet & rates',
    body: 'Your whole roster, whether or not it is listed on the marketplace. Day, week and month rates on each unit, and a record of every change.',
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
