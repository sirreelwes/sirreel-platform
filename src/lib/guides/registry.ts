/**
 * Every how-to page in HQ, in one list — the HQ Help tab reads this.
 *
 * Wes 2026-09-05: "fold each department's instruction pages into a HQ
 * Help tab for them." The guides had been sprinkled into the nav one
 * entry each (five "How to…" links across four role branches), which
 * meant a new guide was a nav edit in four places and a rep saw only the
 * ones someone remembered to add to their branch. Now the nav carries one
 * entry, and this registry decides what each role sees.
 *
 * A guide belongs to a DEPARTMENT (how the Help page groups it) and to the
 * ROLES it is written for (who sees it). ADMIN and MANAGER see everything.
 */

import { UserRole } from '@prisma/client'

export type GuideDepartment = 'Sales' | 'Billing' | 'Yard'

export interface Guide {
  slug: string
  title: string
  /** One line: what you'll be able to do after reading it. */
  summary: string
  department: GuideDepartment
  roles: UserRole[]
}

const SALES: UserRole[] = [UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT]
const YARD: UserRole[] = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.FLEET_TECH,
  UserRole.WAREHOUSE,
  UserRole.DISPATCHER,
]
const BILLING: UserRole[] = [UserRole.ADMIN, UserRole.MANAGER, UserRole.BILLING]

export const GUIDES: Guide[] = [
  {
    slug: 'starting-a-job',
    title: 'How to start a job',
    summary: 'Open the job in HQ and send the client their paperwork portal — no Cognito booking package.',
    department: 'Sales',
    roles: SALES,
  },
  {
    slug: 'sending-orders',
    title: 'How to send orders out',
    summary: 'The handoff into Warehouse and Fleet, and why the two lanes are not the same.',
    department: 'Sales',
    roles: [...SALES, ...YARD],
  },
  {
    slug: 'finishing-a-job',
    title: 'How to finish a job',
    summary: 'Bill it out: the HQ invoice path (generate → pre-invoice → issue) or the RentalWorks path.',
    department: 'Sales',
    roles: [...SALES, UserRole.BILLING],
  },
  {
    slug: 'pull-sheets',
    title: 'How pull sheets work',
    summary: 'Sales generates the pick list, warehouse prints and picks, check-out and check-in update the order.',
    department: 'Yard',
    roles: [...YARD, UserRole.AGENT],
  },
  {
    slug: 'collecting',
    title: 'How to collect',
    summary: 'Running the collections desk: what can be charged, in which invoice states, and the bank-detail fraud rule.',
    department: 'Billing',
    roles: BILLING,
  },
]

export const DEPARTMENT_ORDER: GuideDepartment[] = ['Sales', 'Yard', 'Billing']

/** Guides this role should see, grouped in department order. */
export function guidesFor(role: UserRole): { department: GuideDepartment; guides: Guide[] }[] {
  const all = role === UserRole.ADMIN || role === UserRole.MANAGER
  const seen = new Set<string>()
  return DEPARTMENT_ORDER.map((department) => ({
    department,
    guides: GUIDES.filter((g) => {
      if (g.department !== department || seen.has(g.slug)) return false
      if (!all && !g.roles.includes(role)) return false
      seen.add(g.slug)
      return true
    }),
  })).filter((d) => d.guides.length > 0)
}
