/**
 * The titles on a production company's portal — ONE list.
 *
 * Wes 2026-09-18: "change the title in production company portals from
 * Executive to Executive Producer … leave all the other titles the same,
 * or potentially give me a way to add one if I need to."
 *
 * That second half is why this file exists rather than a one-word edit.
 * The four labels were written out in four places (the two CRM pickers,
 * the portal's People-with-access list, and COMPANY_PORTAL_ROLE_LABEL) and
 * the allowed values in three more, so "change a title" meant finding
 * seven copies and "add a title" meant finding seven copies and getting
 * them all right.
 *
 * ── Two label sets, on purpose
 *
 * `label` is what the CLIENT reads on their own portal. `staffLabel` is
 * what a SirReel rep picks from in the CRM. They differ on exactly one
 * role today and it is worth keeping: OTHER is an honest bucket name to
 * staff, but a person logging in to read "Other" under their own name is
 * being told what we could not be bothered to call them. The client sees
 * "Team".
 *
 * A person's verbatim `CompanyPortalAccess.title` ("VP, Physical
 * Production") still WINS over any of this wherever it is set — these are
 * the fallback when nobody typed one.
 *
 * ── HOW TO ADD A TITLE
 *
 * CompanyPortalRole is a Postgres enum, so a new one is three edits and
 * one statement, in this order:
 *
 *   1. Add the value to `enum CompanyPortalRole` in prisma/schema.prisma.
 *   2. Add a row here — value, label, and staffLabel if staff should read
 *      it differently.
 *   3. Run the enum add against production BEFORE deploying the code:
 *        npx tsx scripts/add-company-portal-role.ts --value NEW_VALUE
 *      It is one idempotent `ALTER TYPE … ADD VALUE IF NOT EXISTS`, so it
 *      is also a single line you can paste into the Neon console from a
 *      phone. It must land first — a deploy that writes a value the
 *      database has never heard of fails at the insert.
 *
 * `npm run test:company-portal-roles` checks this list against the Prisma
 * enum BOTH ways, so a value with no title, or a title with no value,
 * fails there rather than rendering a raw EXECUTIVE_PRODUCER at a client.
 *
 * Renaming a LABEL, as here, needs none of that — the stored value never
 * changes, only what it is called.
 */

import type { CompanyPortalRole } from '@prisma/client'

export interface CompanyPortalRoleSpec {
  value: CompanyPortalRole
  /** What the client reads on their portal. */
  label: string
  /** What staff picks in the CRM. Omit when it is the same word. */
  staffLabel?: string
}

/**
 * Canonical order — what both CRM pickers list, top to bottom. It is not
 * a ranking; it is the order the desk thinks in.
 */
export const COMPANY_PORTAL_ROLE_SPECS: readonly CompanyPortalRoleSpec[] = [
  // Wes 2026-09-18: was "Executive". A production company's exec IS an
  // Executive Producer, and that is the credit they carry.
  { value: 'EXECUTIVE', label: 'Executive Producer' },
  { value: 'HEAD_OF_PRODUCTION', label: 'Head of Production' },
  { value: 'FINANCE', label: 'Finance' },
  { value: 'OTHER', label: 'Team', staffLabel: 'Other' },
]

/** Every allowed value, in canonical order — the API allowlists read this. */
export const COMPANY_PORTAL_ROLE_VALUES: readonly CompanyPortalRole[] =
  COMPANY_PORTAL_ROLE_SPECS.map((r) => r.value)

/** What the CLIENT reads. Falls back to the raw value rather than blank. */
export function companyPortalRoleLabel(role: CompanyPortalRole | string): string {
  return COMPANY_PORTAL_ROLE_SPECS.find((r) => r.value === role)?.label ?? String(role)
}

/** What STAFF picks from in the CRM. */
export function companyPortalRoleStaffLabel(role: CompanyPortalRole | string): string {
  const spec = COMPANY_PORTAL_ROLE_SPECS.find((r) => r.value === role)
  return spec?.staffLabel ?? spec?.label ?? String(role)
}

/** Ready-made options for a `<select>` in the CRM. */
export const COMPANY_PORTAL_ROLE_OPTIONS: readonly { value: CompanyPortalRole; label: string }[] =
  COMPANY_PORTAL_ROLE_SPECS.map((r) => ({ value: r.value, label: r.staffLabel ?? r.label }))
