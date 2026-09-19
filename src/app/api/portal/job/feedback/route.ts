/**
 * The client's end of the improvement box: a star rating, and optionally a
 * suggestion.
 *
 * Wes 2026-09-19: "build the client-facing side, separate lane but also put
 * a quick star ranking system for how they like this platform" — and then
 * "lead with the rating system, and then to the right of it, have a very
 * small thing that says 'Suggest an improvement.'"
 *
 * POST { stars }                  → their standing rating (upserted)
 * POST { body }                   → an improvement, triaged into the CLIENT lane
 * POST { stars, body }            → both
 *
 * ── What a client is never shown ─────────────────────────────────────────
 * Severity, kind, routing, suspects, the fix plan, whether it escalated to
 * Wes, or that a triage agent exists at all. The response here is a plain
 * thank-you and nothing else. Everything the staff box returns — the chips,
 * the verdict, "on the list" — is internal, and a client reading "High /
 * Broken mechanics" about their own rental would reasonably conclude the
 * platform is on fire.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { triageBugReport, type OpenIssue } from '@/lib/bugs/triage'
import { notifyBugEscalation } from '@/lib/bugs/notifyEscalation'
import { OPEN_STATUSES } from '@/lib/bugs/vocab'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }

  const json = await req.json().catch(() => ({}))
  const rawStars = typeof json.stars === 'number' ? Math.round(json.stars) : null
  const stars = rawStars !== null && rawStars >= 1 && rawStars <= 5 ? rawStars : null
  const body = typeof json.body === 'string' ? json.body.trim() : ''

  if (stars === null && body.length < 8) {
    return NextResponse.json({ error: 'Nothing to send.' }, { status: 400 })
  }

  const contact = resolved.contact
  const personName =
    [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim() || contact?.email || 'A client'
  const personEmail = contact?.email ?? ''
  const order = resolved.order as unknown as {
    id: string
    companyId: string | null
    jobId: string | null
    job?: { id: string; name: string | null } | null
  }
  const jobId = order.jobId ?? order.job?.id ?? null
  // The portal's order select does not carry companyId, so read it off the
  // job. Worth the one query: "which client said this" is the first thing
  // anyone asks about a client report, and a null there makes the whole
  // lane anonymous.
  let companyId = order.companyId ?? null
  if (!companyId && jobId) {
    companyId =
      (await prisma.job.findUnique({ where: { id: jobId }, select: { companyId: true } }))?.companyId ?? null
  }

  let ratingSaved = false
  let improvementSaved = false

  try {
    // ── The rating ────────────────────────────────────────────────────
    // jobId is what keys "one standing rating per person per job"; without
    // it there is nothing to upsert against, so the rating is skipped
    // rather than piling up a new row on every tap.
    if (stars !== null && personEmail && jobId) {
      await prisma.platformRating.upsert({
        where: { personEmail_jobId: { personEmail, jobId } },
        create: { stars, source: 'CLIENT', personEmail, personName, companyId, jobId },
        update: { stars },
      })
      ratingSaved = true
    }

    // ── The suggestion ────────────────────────────────────────────────
    if (body.length >= 8) {
      if (body.length > 6000) {
        return NextResponse.json({ error: 'That is longer than the box can take.' }, { status: 400 })
      }
      const report = await prisma.bugReport.create({
        data: {
          body,
          source: 'CLIENT',
          companyId,
          jobId,
          reportedByEmail: personEmail || 'unknown@client',
          reportedByName: personName,
          reportedByRole: 'CLIENT',
          pagePath: typeof json.pagePath === 'string' ? json.pagePath.slice(0, 300) : null,
          userAgent: req.headers.get('user-agent')?.slice(0, 400) ?? null,
        },
      })
      improvementSaved = true

      // Duplicates only ever group within the same lane — a client saying
      // the portal is confusing is not the same to-do as a rep saying it,
      // and merging them would hide the client one behind internal work.
      const openIssues: OpenIssue[] = await prisma.bugReport.findMany({
        where: {
          source: 'CLIENT',
          status: { in: OPEN_STATUSES },
          duplicateOfId: null,
          triagedAt: { not: null },
          id: { not: report.id },
        },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: { id: true, title: true, area: true, kind: true, severity: true },
      })

      const { verdict, error } = await triageBugReport({
        body,
        reporterName: personName,
        reporterRole: 'CLIENT (a paying customer, writing from their own job portal)',
        pagePath: report.pagePath,
        openIssues,
        fromClient: true,
      })

      if (verdict) {
        const isDuplicate = !!verdict.duplicateOf
        const saved = await prisma.bugReport.update({
          where: { id: report.id },
          data: {
            title: verdict.title,
            area: verdict.area,
            severity: verdict.severity,
            kind: verdict.kind,
            routing: verdict.routing,
            reasoning: verdict.reasoning,
            response: verdict.response,
            suspects: verdict.suspects,
            duplicateOfId: verdict.duplicateOf,
            missingContext: verdict.missingContext,
            triagedAt: new Date(),
            triageModel: verdict.model,
            status: isDuplicate ? 'DUPLICATE' : verdict.routing === 'ANSWERED' ? 'ANSWERED' : 'OPEN',
            resolvedAt: isDuplicate || verdict.routing === 'ANSWERED' ? new Date() : null,
          },
        })
        if (saved.routing === 'ESCALATED' && !saved.escalatedAt) {
          const sent = await notifyBugEscalation(saved)
          if (sent.sent) {
            await prisma.bugReport.update({ where: { id: saved.id }, data: { escalatedAt: new Date() } })
          }
        }
      } else {
        await prisma.bugReport.update({ where: { id: report.id }, data: { triageError: error } })
      }
    }

    // Deliberately flat. No verdict, no chips, no "we rated this High".
    return NextResponse.json({
      ok: true,
      ratingSaved,
      improvementSaved,
      message: improvementSaved
        ? 'Thank you — that has gone straight to the team.'
        : 'Thank you.',
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021') {
      console.error('[portal feedback] tables missing — run scripts/add-client-improvements.ts')
      return NextResponse.json({ error: 'Not available just now.' }, { status: 503 })
    }
    console.error('[portal feedback] failed:', e)
    return NextResponse.json({ error: 'Could not send that just now.' }, { status: 500 })
  }
}

/** Their current rating, so the stars render already filled in. */
export async function GET(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) return NextResponse.json({ error: 'No session' }, { status: 401 })
  const email = resolved.contact?.email
  if (!email) return NextResponse.json({ stars: null })
  try {
    const order = resolved.order as unknown as { jobId: string | null; job?: { id: string } | null }
    const jobId = order.jobId ?? order.job?.id ?? null
    if (!jobId) return NextResponse.json({ stars: null })
    const row = await prisma.platformRating.findUnique({
      where: { personEmail_jobId: { personEmail: email, jobId } },
      select: { stars: true },
    })
    return NextResponse.json({ stars: row?.stars ?? null })
  } catch {
    return NextResponse.json({ stars: null })
  }
}
