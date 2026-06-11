/**
 * POST /api/claims/mail-triage/[id]/open-incident
 *
 * NEEDS_REVIEW triage action — replaces the prior direct-to-NewClaim-
 * modal pre-fill flow. Creates an Incident (source=EMAIL) populated
 * from the ClaimMail's stored Sonnet parse, links the email to it as
 * a CORRESPONDENCE document if the body file is already on Blob, and
 * stamps ClaimMail.incidentId for the triage widget.
 *
 * Idempotent: re-clicking the action returns the same Incident.
 *
 * Auth: getServerSession. The rep is recorded as the Incident's
 * createdById for audit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { openIncidentFromClaimMail } from '@/lib/incidents/openIncidentFromClaimMail'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const result = await openIncidentFromClaimMail({
      claimMailId: id,
      createdById: me.id,
    })
    return NextResponse.json(
      { ok: true, incident: result },
      { status: result.created ? 201 : 200 },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'failed'
    if (msg.includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 })
    }
    console.error('[POST /claims/mail-triage/[id]/open-incident] failed:', msg)
    return NextResponse.json({ error: 'failed to open incident' }, { status: 500 })
  }
}
