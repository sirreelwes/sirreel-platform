/**
 * GET / POST /api/crm/companies/[id]/portal-access — who at this client can
 * see the account portal.
 *
 * Wes 2026-09-04: "I would like to have the ability to add multiple emails
 * (titles optional) who can view company portal."
 *
 * So POST takes a LIST. A Head of Production, two executives and the
 * controller get added in one pass, from one paste, rather than four
 * round-trips through a one-at-a-time form.
 *
 * ── Granting creates a Person when there isn't one ─────────────────────
 * An executive is frequently not in HQ at all — they never booked a truck,
 * never appeared on a job. Refusing to grant until someone hand-creates
 * the contact would make the common case the hard case. So an unknown
 * address mints a Person (source `portal_grant`) and the grant hangs off
 * it. The alias-aware lookup runs first, so a deduped old address resolves
 * to the SURVIVING person rather than minting a duplicate.
 *
 * ── The grant is authorization, not authentication ─────────────────────
 * Nothing here issues a credential. The person signs in at
 * /portal/auth/sign-in with this email like any other client; this row is
 * what that session is then allowed to see. Which is also why revoking is
 * a stamp rather than a delete — "who could see this account in March" has
 * to stay answerable.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { CompanyPortalRole } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { normalizeEmail, resolvePersonByEmail } from '@/lib/people/email'

export const dynamic = 'force-dynamic'

const ROLES: CompanyPortalRole[] = ['EXECUTIVE', 'HEAD_OF_PRODUCTION', 'FINANCE', 'OTHER']
const MAX_PER_REQUEST = 25

interface GrantIn {
  email: string
  name?: string | null
  title?: string | null
  role?: string | null
}

function isEmail(s: unknown): s is string {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

/** "Dana Whitfield" → first / last. A one-word name keeps a blank surname. */
function splitName(raw: string | null | undefined, email: string): { first: string; last: string } {
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

async function requireUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const rows = await prisma.companyPortalAccess.findMany({
    where: { companyId: params.id },
    orderBy: [{ revokedAt: 'asc' }, { grantedAt: 'desc' }],
    select: {
      id: true,
      role: true,
      title: true,
      grantedAt: true,
      revokedAt: true,
      invitedAt: true,
      lastAccessedAt: true,
      accessCount: true,
      notifyJobStart: true,
      notifyInvoicePaid: true,
      notifyJobClosed: true,
      notifyQuoteSent: true,
      cadence: true,
      person: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  })

  return NextResponse.json({ ok: true, access: rows })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  })
  if (!company) return NextResponse.json({ error: 'company not found' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as { grants?: unknown } | null
  const raw = Array.isArray(body?.grants) ? body!.grants : []
  if (raw.length === 0) {
    return NextResponse.json({ error: 'Add at least one email address.' }, { status: 400 })
  }
  if (raw.length > MAX_PER_REQUEST) {
    return NextResponse.json(
      { error: `That's more than ${MAX_PER_REQUEST} at once — add them in batches.` },
      { status: 400 },
    )
  }

  // De-dupe within the request; the (companyId, personId) unique handles
  // collisions with rows that already exist.
  const seen = new Set<string>()
  const grants: GrantIn[] = []
  for (const g of raw) {
    const email = typeof g === 'string' ? g : (g as GrantIn)?.email
    if (!isEmail(email)) continue
    const lc = normalizeEmail(email)
    if (seen.has(lc)) continue
    seen.add(lc)
    const obj = (typeof g === 'object' && g !== null ? g : {}) as GrantIn
    grants.push({
      email: lc,
      name: typeof obj.name === 'string' ? obj.name.trim().slice(0, 120) : null,
      title: typeof obj.title === 'string' ? obj.title.trim().slice(0, 120) || null : null,
      role:
        typeof obj.role === 'string' && ROLES.includes(obj.role as CompanyPortalRole)
          ? obj.role
          : 'EXECUTIVE',
    })
  }
  if (grants.length === 0) {
    return NextResponse.json({ error: 'None of those look like email addresses.' }, { status: 400 })
  }

  const created: { email: string; personId: string; accessId: string; isNewPerson: boolean }[] = []
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
      const { first, last } = splitName(g.name, g.email)
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
        .create({ data: { personId, companyId: company.id, isCurrent: true } })
        .catch(() => null)
    }

    const prior = await prisma.companyPortalAccess.findUnique({
      where: { companyId_personId: { companyId: company.id, personId } },
      select: { id: true, revokedAt: true },
    })

    if (prior && !prior.revokedAt) {
      already.push(g.email)
      // A re-add with a title is still a title edit — honour it rather
      // than silently discarding what was typed.
      if (g.title) {
        await prisma.companyPortalAccess.update({
          where: { id: prior.id },
          data: { title: g.title, role: g.role as CompanyPortalRole },
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
          role: g.role as CompanyPortalRole,
          title: g.title,
          grantedById: user.id,
          grantedAt: new Date(),
        },
      })
      restored.push(g.email)
      created.push({ email: g.email, personId, accessId: prior.id, isNewPerson })
      continue
    }

    const access = await prisma.companyPortalAccess.create({
      data: {
        companyId: company.id,
        personId,
        role: g.role as CompanyPortalRole,
        title: g.title,
        grantedById: user.id,
      },
      select: { id: true },
    })
    created.push({ email: g.email, personId, accessId: access.id, isNewPerson })
  }

  return NextResponse.json({
    ok: true,
    granted: created.length,
    restored: restored.length,
    alreadyHad: already.length,
    created,
  })
}
