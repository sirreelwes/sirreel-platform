/**
 * POST /api/portal/company/[companyId]/share — "send this to my production
 * teams."
 *
 * Wes 2026-09-04: "One button would allow them to send this info to their
 * production teams."
 *
 * ── This is mail leaving our domain on a client's instruction ──────────
 * Which makes it the one endpoint on the account portal that can hurt
 * someone who isn't a party to it. Four constraints follow from that, and
 * none of them are optional:
 *
 *   1. RATE LIMITED per access row, not per IP. The point is to stop a
 *      portal session being used as a sending relay; an IP limit is the
 *      wrong axis for a client on a studio network.
 *   2. CAPPED at 25 recipients per send. A production team is a handful of
 *      coordinators. Anything bigger is a mailing list, and we are not one.
 *   3. REPLY-TO is the SENDER, not SirReel. A recipient hitting reply is
 *      answering their own colleague — routing that to us would both
 *      misdirect the reply and make SirReel look like the initiator.
 *   4. RECORDED. Who sent what, to whom, when. `CompanyPortalShare` exists
 *      so "who gave my address to SirReel" has an answer.
 *
 * The payload carries no rates and no invoice figures — see the template.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCompanyPortalSessionFromRequest } from '@/lib/portal/companyPortal'
import { buildCompanyTerms } from '@/lib/portal/companyOverview'
import { buildServiceCatalog } from '@/lib/portal/companyServices'
import { renderCompanyPortalShare } from '@/lib/email/templates/companyPortal'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { checkRateLimit } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

const MAX_RECIPIENTS = 25
const MAX_MESSAGE_CHARS = 1200

interface RecipientIn {
  email: string
  name?: string | null
}

function isPlausibleEmail(s: unknown): s is string {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

function siteBase(req: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL || process.env.PORTAL_BASE_URL
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  return req.nextUrl.origin.replace(/\/$/, '')
}

function fmtDay(d: Date | null | undefined): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * GET — who the executive might want to send it to.
 *
 * Suggestions only, and only people already attached to THIS company's own
 * shows (their coordinators, PMs, transpo) or affiliated with the company.
 * Nobody from another account ever appears here, and the executive can type
 * any address they like anyway — the list saves typing, it is not a gate.
 */
export async function GET(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [jobContacts, affiliations] = await Promise.all([
    prisma.jobContact.findMany({
      where: { job: { companyId: session.companyId } },
      select: {
        role: true,
        person: { select: { firstName: true, lastName: true, email: true } },
      },
      take: 300,
    }),
    prisma.affiliation.findMany({
      where: { companyId: session.companyId, isCurrent: true },
      select: {
        roleOnShow: true,
        person: { select: { firstName: true, lastName: true, email: true } },
      },
      take: 300,
    }),
  ])

  const byEmail = new Map<string, { email: string; name: string; role: string | null }>()
  const add = (
    person: { firstName: string; lastName: string; email: string },
    role: string | null,
  ) => {
    const lc = person.email.toLowerCase()
    // The executive is already reading this page.
    if (lc === session.personEmail.toLowerCase()) return
    if (byEmail.has(lc)) return
    byEmail.set(lc, {
      email: lc,
      name: `${person.firstName} ${person.lastName}`.trim(),
      role: role ? role.replace(/_/g, ' ') : null,
    })
  }
  for (const c of jobContacts) add(c.person, c.role)
  for (const a of affiliations) add(a.person, a.roleOnShow)

  return NextResponse.json({
    ok: true,
    suggestions: [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60),
  })
}

export async function POST(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Keyed on the ACCESS row — the credential doing the sending.
  const rl = checkRateLimit(`company-portal-share:${session.accessId}`)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'You have sent several of these just now. Try again shortly.' },
      { status: 429 },
    )
  }

  const body = (await req.json().catch(() => null)) as {
    recipients?: unknown
    message?: unknown
  } | null

  const rawRecipients = Array.isArray(body?.recipients) ? body!.recipients : []
  const seen = new Set<string>()
  const recipients: RecipientIn[] = []
  for (const r of rawRecipients) {
    const email = typeof r === 'string' ? r : (r as RecipientIn)?.email
    if (!isPlausibleEmail(email)) continue
    const lc = email.trim().toLowerCase()
    if (seen.has(lc)) continue
    seen.add(lc)
    const name =
      typeof r === 'object' && r != null && typeof (r as RecipientIn).name === 'string'
        ? ((r as RecipientIn).name as string).trim().slice(0, 80)
        : null
    recipients.push({ email: lc, name: name || null })
  }

  if (recipients.length === 0) {
    return NextResponse.json({ error: 'Add at least one email address.' }, { status: 400 })
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `That's more than ${MAX_RECIPIENTS} addresses. Send it in smaller groups.` },
      { status: 400 },
    )
  }

  const message =
    typeof body?.message === 'string' && body.message.trim()
      ? body.message.trim().slice(0, MAX_MESSAGE_CHARS)
      : null

  const [terms, services] = await Promise.all([
    buildCompanyTerms(session.companyId),
    buildServiceCatalog(),
  ])

  // Terms the client's own teams need in order to book correctly. No
  // money: an annual agreement's TERM is useful to a coordinator, its
  // negotiated pricing is not theirs to forward.
  const termsRows: { label: string; value: string }[] = []
  if (terms.annual) {
    termsRows.push({
      label: 'Agreement',
      value: `${terms.annual.title || terms.annual.originalFilename} (through ${fmtDay(terms.annual.expiryDate)})`,
    })
    termsRows.push({
      label: 'Signing',
      value: 'Covered for the year — no per-show rental agreement to sign',
    })
  } else {
    termsRows.push({
      label: 'Signing',
      value: "SirReel's rental agreement is signed per show, in the job portal",
    })
  }
  if (terms.standingLcdw) {
    termsRows.push({
      label: 'Damage waiver',
      value: terms.standingLcdw === 'ACCEPTED' ? 'Accepted account-wide' : 'Declined account-wide',
    })
  }
  if (terms.accountRep) {
    termsRows.push({ label: 'Your rep', value: `${terms.accountRep.name} — ${terms.accountRep.email}` })
  }

  const base = siteBase(req)
  let sent = 0
  const failures: string[] = []

  for (const r of recipients) {
    const { subject, html, text } = renderCompanyPortalShare({
      senderName: session.personName,
      senderEmail: session.personEmail,
      recipientName: r.name ?? null,
      companyName: session.companyName,
      message,
      termsRows,
      services: services.lines.map((l) => ({ name: l.name, blurb: l.blurb, href: l.href })),
      siteBase: base,
    })

    const result = await sendAgreementEmail({
      to: [r.email],
      // Constraint 3 — the reply belongs to the colleague who sent it.
      replyTo: session.personEmail,
      subject,
      html,
      text,
      label: 'company-portal-share',
    })
    if (result.ok) sent++
    else failures.push(`${r.email}: ${result.reason || 'send failed'}`)
  }

  await prisma.companyPortalShare.create({
    data: {
      accessId: session.accessId,
      recipients: recipients as unknown as object,
      message,
      sentCount: sent,
      error: failures.length ? failures.join('; ').slice(0, 2000) : null,
    },
  })

  if (sent === 0) {
    return NextResponse.json(
      { error: 'None of those could be sent. Check the addresses and try again.' },
      { status: 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    sent,
    failed: failures.length,
    message:
      failures.length === 0
        ? `Sent to ${sent} ${sent === 1 ? 'person' : 'people'}.`
        : `Sent to ${sent}; ${failures.length} could not be delivered.`,
  })
}
