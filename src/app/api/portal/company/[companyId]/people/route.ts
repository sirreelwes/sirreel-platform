/**
 * GET / POST /api/portal/company/[companyId]/people — who can open this
 * account, and the client adding a colleague themselves.
 *
 * Wes 2026-09-06: "even though there is no password, only Ding Ding can
 * currently access and if she wants to add people she can do so in her
 * portal."
 *
 * ── Who may add ────────────────────────────────────────────────────────
 * Anyone with a live grant. Not just executives: the first person on an
 * account is often a producer (Dingding is role OTHER), and gating this on
 * a role would make the one person we invited unable to bring in the boss.
 * The grant they create is recorded against THEIR access row
 * (`grantedByAccessId`), so the staff panel shows "added by Dingding Hu
 * from the portal" rather than an unexplained new name.
 *
 * ── What it does not do ────────────────────────────────────────────────
 * No removals. Revoking is a staff action — a client who wants someone out
 * tells their rep, and "who could see this account in March" stays a
 * question with one answer.
 *
 * ── Consequences are visible ───────────────────────────────────────────
 * The new person is emailed the same invite a rep would send (named after
 * the colleague who added them), and HQ hears about it on the
 * `portal-people` channel. Capped and rate-limited per access row so a
 * session can't be used to spray invites.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyPortalSessionFromRequest } from '@/lib/portal/companyPortal'
import {
  grantCompanyPortalAccess,
  listCompanyPortalPeople,
  normalizeGrantInputs,
} from '@/lib/portal/grantCompanyAccess'
import { renderCompanyPortalInvite } from '@/lib/email/templates/companyPortal'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { findCompanyAnnualCoverage } from '@/lib/orders/annualCoverage'
import { findPendingAnnual } from '@/lib/portal/companyAnnual'
import { checkRateLimit } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

const MAX_PER_REQUEST = 10
/** Ten adds an hour per access row — a team, not a mailing list. */
const RATE = { windowMs: 60 * 60_000, max: 10 }

const listPeople = listCompanyPortalPeople

export async function GET(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, people: await listPeople(session.companyId, session.accessId) })
}

export async function POST(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rl = checkRateLimit(`company-portal-people:${session.accessId}`, RATE)
  if (!rl.ok) {
    return NextResponse.json(
      { error: "That's a lot of additions in a short time — try again in a while, or ask your rep." },
      { status: 429 },
    )
  }

  const body = (await req.json().catch(() => null)) as { people?: unknown } | null
  const raw = Array.isArray(body?.people) ? body!.people : []
  if (raw.length === 0) {
    return NextResponse.json({ error: 'Add at least one email address.' }, { status: 400 })
  }
  if (raw.length > MAX_PER_REQUEST) {
    return NextResponse.json(
      { error: `Up to ${MAX_PER_REQUEST} at a time — add the rest in a second pass.` },
      { status: 400 },
    )
  }

  // Role is not the client's to pick — everyone they add is "Team" unless a
  // rep promotes them. The title they type is what prints in the header.
  const grants = normalizeGrantInputs(raw, { defaultRole: 'OTHER', lockRole: true })
  if (grants.length === 0) {
    return NextResponse.json({ error: 'None of those look like email addresses.' }, { status: 400 })
  }
  if (grants.some((g) => g.email === session.personEmail.toLowerCase())) {
    return NextResponse.json({ error: "That's you — you already have access." }, { status: 400 })
  }

  const company = await prisma.company.findUnique({
    where: { id: session.companyId },
    select: { id: true, name: true, defaultAgent: { select: { name: true, email: true } } },
  })
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const result = await grantCompanyPortalAccess(company.id, grants, {
    userId: null,
    accessId: session.accessId,
  })

  // Tell the people who were just let in. The invite is what makes the
  // grant real to them; a silent grant from a colleague is a mystery row.
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.PORTAL_BASE_URL || req.nextUrl.origin).replace(/\/$/, '')
  const [annual, pending] = await Promise.all([
    findCompanyAnnualCoverage(company.id),
    findPendingAnnual(company.id),
  ])
  const rep = company.defaultAgent
  let invited = 0
  for (const c of result.created) {
    const access = await prisma.companyPortalAccess.findUnique({
      where: { id: c.accessId },
      select: { person: { select: { firstName: true } } },
    })
    const others = (await listPeople(company.id, c.accessId)).filter((p) => p.accessId !== c.accessId)
    const { subject, html, text } = renderCompanyPortalInvite({
      firstName: access?.person.firstName || c.email.split('@')[0],
      companyName: company.name,
      portalUrl: `${base}/portal/company/${company.id}`,
      repName: rep?.name || 'Your SirReel rep',
      repEmail: rep?.email || null,
      annualAgreementTitle: annual ? annual.title || annual.originalFilename : null,
      pendingAnnual:
        !annual && pending
          ? { title: pending.title, signUrl: `${base}/portal/company/${company.id}/sign/annual` }
          : null,
      otherPeople: others.map((o) => ({ name: o.name, title: o.title })),
      addedByName: session.personName,
    })
    const sent = await sendAgreementEmail({
      to: [c.email],
      replyTo: rep?.email || undefined,
      subject,
      html,
      text,
      label: 'company-portal-invite-by-client',
    }).catch(() => ({ ok: false as const }))
    if (sent.ok) {
      invited++
      await prisma.companyPortalAccess.update({
        where: { id: c.accessId },
        data: { invitedAt: new Date() },
      })
    }
  }

  // The desk hears about it once per request, not once per name.
  if (result.created.length > 0) {
    await prisma.auditLog
      .create({
        data: {
          action: 'company_portal.client_grant',
          entityType: 'company',
          entityId: company.id,
          newValues: {
            byAccessId: session.accessId,
            byName: session.personName,
            byEmail: session.personEmail,
            added: result.created.map((c) => c.email),
            restored: result.restored,
          },
        },
      })
      .catch(() => null)
    const to = await channelRecipients('portal-people').catch(() => [] as string[])
    if (to.length > 0) {
      const names = result.created.map((c) => c.email).join(', ')
      const line = `${session.personName} (${session.personEmail}) added ${names} to the ${company.name} company portal from inside it.`
      await sendAgreementEmail({
        to,
        subject: `${session.personName} added ${result.created.length === 1 ? 'someone' : `${result.created.length} people`} to the ${company.name} portal`,
        html: `<p>${line}</p><p><a href="${base}/crm/portals">${base}/crm/portals</a></p>`,
        text: `${line}\n\n${base}/crm/portals`,
        label: 'company-portal-client-grant',
      }).catch(() => null)
    }
  }

  return NextResponse.json({
    ok: true,
    added: result.created.length,
    invited,
    alreadyHad: result.already.length,
    people: await listPeople(company.id, session.accessId),
  })
}
