/**
 * Granting account-portal access — the one implementation behind both
 * doors.
 *
 * Two callers:
 *   - staff, from /crm/portals (POST /api/crm/companies/[id]/portal-access)
 *   - the CLIENT, from inside their own portal (POST
 *     /api/portal/company/[companyId]/people) — Wes 2026-09-06: "if she
 *     wants to add people she can do so in her portal."
 *
 * They differ only in who is recorded as the grantor: a User id for a rep,
 * a CompanyPortalAccess id for a client. Everything else — the alias-aware
 * person lookup, minting a Person for an address HQ has never seen, the
 * affiliation so they appear on the CRM page, the restore-not-duplicate
 * rule for a revoked row — has to behave identically, or the client's
 * "add" would quietly create the duplicate contacts the staff path was
 * written to avoid.
 */

import type { CompanyPortalRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeEmail, resolvePersonByEmail } from '@/lib/people/email'

export const COMPANY_PORTAL_ROLES: CompanyPortalRole[] = [
  'EXECUTIVE',
  'HEAD_OF_PRODUCTION',
  'FINANCE',
  'OTHER',
]

export interface GrantInput {
  email: string
  name?: string | null
  title?: string | null
  role?: string | null
}

export interface GrantResult {
  created: { email: string; personId: string; accessId: string; isNewPerson: boolean }[]
  restored: string[]
  already: string[]
}

export function isEmailAddress(s: unknown): s is string {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

/** "Dana Whitfield" → first / last. A one-word name keeps a blank surname. */
export function splitPersonName(
  raw: string | null | undefined,
  email: string,
): { first: string; last: string } {
  const t = (raw ?? '').trim()
  if (!t) {
    // Person.firstName is required; the local part is a better placeholder
    // than an empty string, and staff can fix it on the contact page.
    return { first: email.split('@')[0] || 'Contact', last: '' }
  }
  const parts = t.split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

/**
 * Normalise a raw list (strings or objects) into de-duplicated grants.
 * Invalid addresses are dropped silently — the caller decides whether an
 * empty result is an error.
 */
export function normalizeGrantInputs(
  raw: unknown[],
  opts: { defaultRole: CompanyPortalRole; lockRole?: boolean },
): (GrantInput & { email: string; role: CompanyPortalRole })[] {
  const seen = new Set<string>()
  const out: (GrantInput & { email: string; role: CompanyPortalRole })[] = []
  for (const g of raw) {
    const email = typeof g === 'string' ? g : (g as GrantInput)?.email
    if (!isEmailAddress(email)) continue
    const lc = normalizeEmail(email)
    if (seen.has(lc)) continue
    seen.add(lc)
    const obj = (typeof g === 'object' && g !== null ? g : {}) as GrantInput
    const role =
      !opts.lockRole &&
      typeof obj.role === 'string' &&
      COMPANY_PORTAL_ROLES.includes(obj.role as CompanyPortalRole)
        ? (obj.role as CompanyPortalRole)
        : opts.defaultRole
    out.push({
      email: lc,
      name: typeof obj.name === 'string' ? obj.name.trim().slice(0, 120) || null : null,
      title: typeof obj.title === 'string' ? obj.title.trim().slice(0, 120) || null : null,
      role,
    })
  }
  return out
}

export async function grantCompanyPortalAccess(
  companyId: string,
  grants: (GrantInput & { email: string; role: CompanyPortalRole })[],
  by: { userId: string | null; accessId: string | null },
): Promise<GrantResult> {
  const created: GrantResult['created'] = []
  const restored: string[] = []
  const already: string[] = []

  for (const g of grants) {
    // Alias-aware first — a merged old address must land on the survivor.
    const existing = (await resolvePersonByEmail(g.email, {
      select: { id: true },
    })) as { id: string } | null

    let personId = existing?.id ?? null
    let isNewPerson = false
    if (!personId) {
      const { first, last } = splitPersonName(g.name, g.email)
      const person = await prisma.person.create({
        data: {
          firstName: first,
          lastName: last,
          email: g.email,
          rawTitle: g.title,
          source: 'portal_grant',
        },
        select: { id: true },
      })
      personId = person.id
      isNewPerson = true
      // Affiliate them with the company so they show up on the CRM page
      // as a contact rather than only inside the portal panel.
      await prisma.affiliation
        .create({ data: { personId, companyId, isCurrent: true } })
        .catch(() => null)
    }

    const prior = await prisma.companyPortalAccess.findUnique({
      where: { companyId_personId: { companyId, personId } },
      select: { id: true, revokedAt: true },
    })

    if (prior && !prior.revokedAt) {
      already.push(g.email)
      // A re-add with a title is still a title edit — honour it rather
      // than silently discarding what was typed.
      if (g.title) {
        await prisma.companyPortalAccess.update({
          where: { id: prior.id },
          data: { title: g.title, role: g.role },
        })
      }
      continue
    }

    if (prior?.revokedAt) {
      await prisma.companyPortalAccess.update({
        where: { id: prior.id },
        data: {
          revokedAt: null,
          revokedById: null,
          role: g.role,
          title: g.title,
          grantedById: by.userId,
          grantedByAccessId: by.accessId,
          grantedAt: new Date(),
        },
      })
      restored.push(g.email)
      created.push({ email: g.email, personId, accessId: prior.id, isNewPerson })
      continue
    }

    const access = await prisma.companyPortalAccess.create({
      data: {
        companyId,
        personId,
        role: g.role,
        title: g.title,
        grantedById: by.userId,
        grantedByAccessId: by.accessId,
      },
      select: { id: true },
    })
    created.push({ email: g.email, personId, accessId: access.id, isNewPerson })
  }

  return { created, restored, already }
}

/**
 * The facts the invite email states about who else can see the account:
 * every OTHER active grant, by name. Computed at send time so the mail
 * never claims "you're the only one" a week after a colleague was added.
 */
export async function listOtherAccessHolders(
  companyId: string,
  excludeAccessId: string,
): Promise<{ name: string; title: string | null }[]> {
  const rows = await prisma.companyPortalAccess.findMany({
    where: { companyId, revokedAt: null, id: { not: excludeAccessId } },
    orderBy: { grantedAt: 'asc' },
    select: {
      title: true,
      role: true,
      person: { select: { firstName: true, lastName: true, email: true } },
    },
  })
  return rows.map((r) => ({
    name: `${r.person.firstName} ${r.person.lastName}`.trim() || r.person.email,
    title: r.title,
  }))
}

export interface CompanyPortalPersonRow {
  accessId: string
  name: string
  email: string
  title: string | null
  role: CompanyPortalRole
  isYou: boolean
  addedByName: string | null
  invitedAt: string | null
  lastOpenedAt: string | null
}

/**
 * Everyone who can open this account, as the portal's "People with access"
 * list shows it. `viewerAccessId` marks the "YOU" row; HQ's preview passes
 * the persona it is viewing as.
 */
export async function listCompanyPortalPeople(
  companyId: string,
  viewerAccessId: string | null,
): Promise<CompanyPortalPersonRow[]> {
  const rows = await prisma.companyPortalAccess.findMany({
    where: { companyId, revokedAt: null },
    orderBy: { grantedAt: 'asc' },
    select: {
      id: true,
      title: true,
      role: true,
      invitedAt: true,
      lastAccessedAt: true,
      grantedByAccessId: true,
      person: { select: { firstName: true, lastName: true, email: true } },
    },
  })
  const nameOf = new Map(
    rows.map((r) => [r.id, `${r.person.firstName} ${r.person.lastName}`.trim() || r.person.email]),
  )
  return rows.map((r) => ({
    accessId: r.id,
    name: nameOf.get(r.id)!,
    email: r.person.email,
    title: r.title,
    role: r.role,
    isYou: r.id === viewerAccessId,
    addedByName: r.grantedByAccessId ? nameOf.get(r.grantedByAccessId) ?? 'a colleague' : null,
    invitedAt: r.invitedAt ? r.invitedAt.toISOString() : null,
    lastOpenedAt: r.lastAccessedAt ? r.lastAccessedAt.toISOString() : null,
  }))
}
