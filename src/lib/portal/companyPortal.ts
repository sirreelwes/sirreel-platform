/**
 * Authorization for the production-company (account) portal.
 *
 * ── The boundary this file defends ─────────────────────────────────────
 * Every other client surface is scoped to a piece of WORK — one order, one
 * job, one after-hours run. This one is scoped to a COMPANY, which means a
 * single wrong resolve does not leak one job, it leaks an entire client's
 * book: every show, every invoice total, every signed agreement. So the
 * resolve is written once, here, and every route and page on the account
 * portal goes through it. No route re-derives access from a companyId in
 * the URL.
 *
 * Three things must all hold, and all three are checked on every request:
 *   1. A valid PersonSession cookie (signature AND `revokedAt`).
 *   2. A CompanyPortalAccess row joining that Person to that Company.
 *   3. That row is not revoked.
 *
 * The cookie is authentication and nothing more. It says who is asking;
 * this row says what they may see. They are separate on purpose — pulling
 * an executive's account access must not lock them out of a job portal
 * they are legitimately a contact on.
 *
 * ── Why 404 and not 403 ────────────────────────────────────────────────
 * A signed-in person poking at another company's id learns nothing: the
 * answer for "no such company" and "not your company" is identical. 403
 * would confirm the company exists, which is a client list leaking one id
 * at a time.
 */

import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import type { CompanyPortalRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  PERSON_SESSION_COOKIE,
  verifyPersonSessionCookieValue,
} from '@/lib/portal/personSession'

export interface CompanyPortalSession {
  accessId: string
  companyId: string
  companyName: string
  personId: string
  personName: string
  personEmail: string
  role: CompanyPortalRole
  title: string | null
}

export interface CompanyPortalGrant {
  accessId: string
  companyId: string
  companyName: string
  role: CompanyPortalRole
}

/** Resolve the signed-in Person from the portal session cookie, or null. */
async function resolveSignedInPerson(
  cookieValue: string | undefined | null,
): Promise<{ id: string; firstName: string; lastName: string; email: string } | null> {
  const verified = verifyPersonSessionCookieValue(cookieValue)
  if (!verified) return null

  const session = await prisma.personSession.findUnique({
    where: { id: verified.personSessionId },
    select: {
      revokedAt: true,
      person: {
        select: { id: true, firstName: true, lastName: true, email: true, isActive: true },
      },
    },
  })
  // A signature that verifies is NOT authorization — the row governs.
  if (!session || session.revokedAt) return null
  if (!session.person.isActive) return null
  return session.person
}

/**
 * Every company this signed-in person may view, newest grant first.
 * Empty array covers both "not signed in" and "signed in, no grants" —
 * the caller decides which message to show from `signedIn` below.
 */
export async function listCompanyPortalGrants(
  cookieValue: string | undefined | null,
): Promise<{ signedIn: boolean; personName: string; grants: CompanyPortalGrant[] }> {
  const person = await resolveSignedInPerson(cookieValue)
  if (!person) return { signedIn: false, personName: '', grants: [] }

  const rows = await prisma.companyPortalAccess.findMany({
    where: { personId: person.id, revokedAt: null },
    orderBy: { grantedAt: 'desc' },
    select: {
      id: true,
      role: true,
      company: { select: { id: true, name: true } },
    },
  })

  return {
    signedIn: true,
    personName: `${person.firstName} ${person.lastName}`.trim(),
    grants: rows.map((r) => ({
      accessId: r.id,
      companyId: r.company.id,
      companyName: r.company.name,
      role: r.role,
    })),
  }
}

/**
 * The single gate. Returns the session for (cookie, companyId) or null —
 * null meaning "show a 404", never "show a reason".
 *
 * `touch` bumps the access counters. Pages pass true; polling API reads
 * pass false so a page load counts once rather than once per widget.
 */
export async function resolveCompanyPortalSession(
  cookieValue: string | undefined | null,
  companyId: string,
  opts: { touch?: boolean } = {},
): Promise<CompanyPortalSession | null> {
  const person = await resolveSignedInPerson(cookieValue)
  if (!person) return null

  const access = await prisma.companyPortalAccess.findUnique({
    where: { companyId_personId: { companyId, personId: person.id } },
    select: {
      id: true,
      role: true,
      title: true,
      revokedAt: true,
      company: { select: { id: true, name: true } },
    },
  })
  if (!access || access.revokedAt) return null

  if (opts.touch) {
    // Fire-and-forget: a failed counter update must never 500 the portal.
    prisma.companyPortalAccess
      .update({
        where: { id: access.id },
        data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
      })
      .catch(() => {})
  }

  return {
    accessId: access.id,
    companyId: access.company.id,
    companyName: access.company.name,
    personId: person.id,
    personName: `${person.firstName} ${person.lastName}`.trim(),
    personEmail: person.email,
    role: access.role,
    title: access.title,
  }
}

/** Server-component convenience — reads the cookie jar itself. */
export async function getCompanyPortalSession(
  companyId: string,
  opts: { touch?: boolean } = {},
): Promise<CompanyPortalSession | null> {
  return resolveCompanyPortalSession(cookies().get(PERSON_SESSION_COOKIE)?.value, companyId, opts)
}

/** Route-handler convenience — reads the cookie off the request. */
export async function getCompanyPortalSessionFromRequest(
  req: NextRequest,
  companyId: string,
): Promise<CompanyPortalSession | null> {
  return resolveCompanyPortalSession(req.cookies.get(PERSON_SESSION_COOKIE)?.value, companyId, {
    touch: false,
  })
}

export const COMPANY_PORTAL_ROLE_LABEL: Record<CompanyPortalRole, string> = {
  EXECUTIVE: 'Executive',
  HEAD_OF_PRODUCTION: 'Head of Production',
  FINANCE: 'Finance',
  OTHER: 'Team',
}
