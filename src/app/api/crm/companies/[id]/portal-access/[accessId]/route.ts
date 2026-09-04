/**
 * PATCH / DELETE /api/crm/companies/[id]/portal-access/[accessId]
 *
 * PATCH edits the title / role, or sends (re-sends) the invite email.
 * DELETE revokes — a stamp, never a row deletion, so "who could see this
 * account in March" stays answerable. Re-granting the same person lifts the
 * stamp rather than creating a second row (see the POST sibling).
 *
 * The invite is what actually tells the person the portal exists. Granting
 * without sending is a legitimate state — a rep sets up four executives and
 * mails them when the deal closes — so it is a separate, explicit action
 * and `invitedAt` records that it happened.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { CompanyPortalRole } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { renderCompanyPortalInvite } from '@/lib/email/templates/companyPortal'
import { findCompanyAnnualCoverage } from '@/lib/orders/annualCoverage'

export const dynamic = 'force-dynamic'

const ROLES: CompanyPortalRole[] = ['EXECUTIVE', 'HEAD_OF_PRODUCTION', 'FINANCE', 'OTHER']

function portalBase(req: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL || process.env.PORTAL_BASE_URL
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return req.nextUrl.origin.replace(/\/$/, '')
}

async function requireUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, name: true, email: true },
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; accessId: string } },
) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const access = await prisma.companyPortalAccess.findFirst({
    where: { id: params.accessId, companyId: params.id },
    select: {
      id: true,
      revokedAt: true,
      company: { select: { id: true, name: true, defaultAgent: { select: { name: true, email: true } } } },
      person: { select: { firstName: true, email: true } },
    },
  })
  if (!access) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as {
    title?: unknown
    role?: unknown
    sendInvite?: unknown
  }

  if (body.sendInvite === true) {
    if (access.revokedAt) {
      return NextResponse.json(
        { error: 'That access is revoked — restore it before sending an invite.' },
        { status: 400 },
      )
    }
    const annual = await findCompanyAnnualCoverage(access.company.id)
    const rep = access.company.defaultAgent
    const { subject, html, text } = renderCompanyPortalInvite({
      firstName: access.person.firstName,
      companyName: access.company.name,
      portalUrl: `${portalBase(req)}/portal/company/${access.company.id}`,
      repName: rep?.name || user.name || 'Your SirReel rep',
      repEmail: rep?.email || user.email || null,
      annualAgreementTitle: annual ? annual.title || annual.originalFilename : null,
    })
    const result = await sendAgreementEmail({
      to: [access.person.email],
      // Replies go to the rep who owns the account, falling back to the
      // person who clicked send — never to a no-reply.
      replyTo: rep?.email || user.email || undefined,
      subject,
      html,
      text,
      label: 'company-portal-invite',
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.reason || 'Send failed' }, { status: 502 })
    }
    await prisma.companyPortalAccess.update({
      where: { id: access.id },
      data: { invitedAt: new Date() },
    })
    return NextResponse.json({ ok: true, invited: true })
  }

  const data: Record<string, unknown> = {}
  if (typeof body.title === 'string') data.title = body.title.trim().slice(0, 120) || null
  if (typeof body.role === 'string' && ROLES.includes(body.role as CompanyPortalRole)) {
    data.role = body.role
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await prisma.companyPortalAccess.update({
    where: { id: access.id },
    data,
    select: { id: true, title: true, role: true },
  })
  return NextResponse.json({ ok: true, access: updated })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; accessId: string } },
) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const access = await prisma.companyPortalAccess.findFirst({
    where: { id: params.accessId, companyId: params.id },
    select: { id: true },
  })
  if (!access) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await prisma.companyPortalAccess.update({
    where: { id: access.id },
    data: { revokedAt: new Date(), revokedById: user.id },
  })
  return NextResponse.json({ ok: true })
}
