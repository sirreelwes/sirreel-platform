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
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCompanyTermsEditor } from '@/lib/portal/companyTermsEditors'
import { grantCompanyPortalAccess, normalizeGrantInputs } from '@/lib/portal/grantCompanyAccess'

export const dynamic = 'force-dynamic'

const MAX_PER_REQUEST = 25

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
      grantedByAccessId: true,
      person: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  })

  // A client-made grant names who let them in (see grantCompanyAccess.ts).
  const granterIds = [...new Set(rows.map((r) => r.grantedByAccessId).filter((x): x is string => !!x))]
  const granters = granterIds.length
    ? await prisma.companyPortalAccess.findMany({
        where: { id: { in: granterIds } },
        select: { id: true, person: { select: { firstName: true, lastName: true, email: true } } },
      })
    : []
  const granterName = new Map(
    granters.map((g) => [g.id, `${g.person.firstName} ${g.person.lastName}`.trim() || g.person.email]),
  )

  return NextResponse.json({
    ok: true,
    access: rows.map((r) => ({
      ...r,
      addedFromPortalBy: r.grantedByAccessId ? granterName.get(r.grantedByAccessId) ?? 'a colleague' : null,
    })),
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireCompanyTermsEditor()
  if ('error' in g) return g.error
  const user = g.user

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

  const grants = normalizeGrantInputs(raw, { defaultRole: 'EXECUTIVE' })
  if (grants.length === 0) {
    return NextResponse.json({ error: 'None of those look like email addresses.' }, { status: 400 })
  }

  const { created, restored, already } = await grantCompanyPortalAccess(company.id, grants, {
    userId: user.id,
    accessId: null,
  })

  return NextResponse.json({
    ok: true,
    granted: created.length,
    restored: restored.length,
    alreadyHad: already.length,
    created,
  })
}
