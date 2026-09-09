/**
 * Starter templates for the outreach composer.
 *
 * Copy that has been through Wes lives HERE, in git, not in a rep's
 * clipboard or a Google Doc. The composer prefills from it; anything typed
 * after that is the rep's own and is never written back. So a template is
 * a starting point with an owner, and "which version did we send" stays
 * answerable through the campaign row, which snapshots the body it was
 * released with.
 *
 * A template also carries its AUDIENCE, because most of the ways this copy
 * can embarrass us are audience mistakes rather than wording ones — mailing
 * an executive who already has the portal open, or mailing a coordinator
 * copy that talks about "your teams" and their company's rates.
 */

import type { PersonRoleValue } from '@/lib/crm/roleMapping'

export interface OutreachStarterTemplate {
  key: string
  /** Button label in the composer. */
  label: string
  /** One line under the label — who it's for. */
  blurb: string
  /** Prefilled internal campaign name; the rep edits it. */
  defaultName: string
  subject: string
  body: string
  /** Roles the copy was written for. Preselected, not enforced. */
  roleKeys?: PersonRoleValue[]
  /** Preselect "skip anyone who already has account access". */
  excludePortalAccess?: boolean
  /** Shown once the template is picked — what to check before releasing. */
  note?: string
}

/**
 * The executive-portal invite (Wes, 2026-09-09).
 *
 * Every claim in it is something /portal/company/[id] does today: the show
 * list with lead and dates, the four notification elections with
 * immediate/weekly/off, the CompanyRate + CompanyDiscount tiles, the annual
 * offered for signature, and People with access. Do not add a capability
 * to this copy that the portal does not yet have — the recipient opens it
 * within the minute.
 */
const EXEC_PORTAL_INVITE_BODY = `{{first_name}},

We built a page for {{company}} — one place to see every show your teams have with us: what's out, what's coming back, who's running it, what's been quoted and invoiced, and which paperwork is signed.

You choose what reaches you — a show starting, an invoice paid, a quote going out — as it happens, weekly, or not at all. Your negotiated rates and standing discounts are on it too, exactly as they get applied to an order. If you'd rather sign one agreement a year than one per show, that's set up from there as well.

Sign-in is your email address, no password, and you can add anyone else at {{company}} who should see it.

Want one? Reply and I'll open it.

{{sender_first_name}}`

const EXEC_PORTAL_INVITE_SHORT_BODY = `{{first_name}},

We made a page for {{company}}: what your teams have out with us, what's been invoiced, what's signed, your rates. Set it to ping you or leave it quiet — it's just there when you want to look.

Say the word and I'll open one for you.

{{sender_first_name}}`

/**
 * The close is REPLY-TO-OPEN on purpose, not a link.
 *
 * There is no self-serve signup: access is a CompanyPortalAccess grant.
 * A recipient with no Person row gets nothing at all from the sign-in page
 * (the response is neutral by design and no mail is sent), and one with a
 * Person but no grant lands on the "you don't have account access" page.
 * Either way a "create your profile" link reads as broken. A reply routes
 * to a human who grants it at /crm/portals, which fires the real invite.
 */
export const OUTREACH_TEMPLATES: OutreachStarterTemplate[] = [
  {
    key: 'exec-portal-invite',
    label: 'Executive portal invite',
    blurb: 'Owners, heads of production and EPs — offers them the account portal.',
    defaultName: 'Executive portal invite',
    subject: 'a page for {{company}}',
    body: EXEC_PORTAL_INVITE_BODY,
    roleKeys: ['OWNER', 'PRODUCTION_MANAGER', 'PRODUCER'],
    excludePortalAccess: true,
    note: 'Replies come to you — grant the portal from Clients → Portals and the branded invite goes out on its own. "Head of production" is filed under Production Manager and "executive producer" under Producer, which is why those two roles are on.',
  },
  {
    key: 'exec-portal-invite-short',
    label: 'Executive portal invite (short)',
    blurb: 'Same offer, four lines — for people who already know you.',
    defaultName: 'Executive portal invite (short)',
    subject: 'a page for {{company}}',
    body: EXEC_PORTAL_INVITE_SHORT_BODY,
    roleKeys: ['OWNER', 'PRODUCTION_MANAGER', 'PRODUCER'],
    excludePortalAccess: true,
    note: 'Reads as a note between people who have met. For a cold list, use the longer one.',
  },
]

export function findOutreachTemplate(key: string | null | undefined): OutreachStarterTemplate | null {
  if (!key) return null
  return OUTREACH_TEMPLATES.find((t) => t.key === key) ?? null
}
