/**
 * The bug box — submit (POST) and read the board (GET).
 *
 * POST is open to every signed-in HQ user, whatever their role: warehouse,
 * fleet, dispatch, sales, billing. Wes 2026-09-18 wants "a to-do list of
 * all the issues that have come through from every person interacting with
 * the site", and the person most likely to find the broken button is the
 * one using it at 6am, not an admin.
 *
 * The triage agent runs INSIDE the request, deliberately. It costs a couple
 * of seconds, and buying those back with a fire-and-forget promise would
 * mean the reporter gets a bare "thanks" and the serverless function is
 * free to die mid-triage — which is exactly the kind of silent nothing the
 * box exists to catch. They wait, and they get a real answer back.
 *
 * A triage failure never fails the submission: the row is already saved
 * before the model is called.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-admin'
import { triageBugReport, type OpenIssue } from '@/lib/bugs/triage'
import { notifyBugEscalation } from '@/lib/bugs/notifyEscalation'
import { acknowledgement, OPEN_STATUSES } from '@/lib/bugs/vocab'

export const dynamic = 'force-dynamic'

/** The table arrives by additive SQL, not db push — see the script. */
const MISSING_TABLE = 'P2021'
const SETUP_HINT =
  'The bug box is not set up on this database yet — run scripts/add-bug-reports-table.ts. Your report was not saved; please tell Wes directly.'

function isMissingTable(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === MISSING_TABLE
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const json = await req.json().catch(() => ({}))
  const body = typeof json.body === 'string' ? json.body.trim() : ''
  const pagePath = typeof json.pagePath === 'string' ? json.pagePath.slice(0, 300) : null

  // Low floor on purpose. "save button broken" is a perfectly good report
  // and we would rather have it than an empty box.
  if (body.length < 8) {
    return NextResponse.json({ error: 'Tell us a little more about what happened.' }, { status: 400 })
  }
  if (body.length > 6000) {
    return NextResponse.json({ error: 'That is longer than the box can take — trim it a little.' }, { status: 400 })
  }

  try {
    const report = await prisma.bugReport.create({
      data: {
        body,
        reportedById: user.id,
        reportedByEmail: user.email,
        reportedByName: user.name || user.email,
        reportedByRole: user.role,
        pagePath,
        userAgent: req.headers.get('user-agent')?.slice(0, 400) ?? null,
      },
    })

    // Candidates for "this is the same thing someone already told us".
    // Only real, open, already-triaged to-dos — never another untriaged row
    // (two unsorted reports cannot be known to be the same thing) and never
    // a duplicate itself, so groups stay one level deep.
    const openIssues: OpenIssue[] = await prisma.bugReport.findMany({
      where: {
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
      reporterName: report.reportedByName,
      reporterRole: report.reportedByRole,
      pagePath: report.pagePath,
      openIssues,
    })

    if (!verdict) {
      const untriaged = await prisma.bugReport.update({
        where: { id: report.id },
        data: { triageError: error, triagedAt: null },
      })
      // Still a success for the reporter — it is on the board, it just has
      // to be sorted by a person. Never make them feel their report bounced.
      return NextResponse.json({
        ok: true,
        report: { id: untriaged.id, routing: 'PENDING', severity: 'UNTRIAGED', kind: 'UNTRIAGED' },
        acknowledgement: 'Got it, and thank you — this one will be read by a person shortly.',
        response: null,
      })
    }

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
        triagedAt: new Date(),
        triageModel: verdict.model,
        triageError: null,
        // ANSWERED closes it — nothing was broken. A duplicate closes too:
        // the work lives on the report it joined.
        status: isDuplicate ? 'DUPLICATE' : verdict.routing === 'ANSWERED' ? 'ANSWERED' : 'OPEN',
        resolvedAt: isDuplicate || verdict.routing === 'ANSWERED' ? new Date() : null,
      },
    })

    // Escalate once. A duplicate of something already escalated does not
    // re-ping Wes — but a duplicate of a QUEUED issue that has now been hit
    // by a second person and read as blocking still does.
    if (saved.routing === 'ESCALATED' && !saved.escalatedAt) {
      const sent = await notifyBugEscalation(saved)
      if (sent.sent) {
        await prisma.bugReport.update({ where: { id: saved.id }, data: { escalatedAt: new Date() } })
      }
    }

    // What the reporter is shown. A duplicate is told the truth — someone
    // already flagged it — which is friendlier than a silent merge and
    // stops them wondering whether it went anywhere.
    return NextResponse.json({
      ok: true,
      report: {
        id: saved.id,
        title: saved.title,
        area: saved.area,
        severity: saved.severity,
        kind: saved.kind,
        routing: saved.routing,
        duplicate: isDuplicate,
      },
      acknowledgement: isDuplicate
        ? 'You are not the first to hit this — your report joined the one already open, which bumps it up the list.'
        : acknowledgement(saved.routing, saved.severity),
      // Only the ANSWERED text is for them. The queued/escalated `response`
      // is a fix plan written for a developer; showing it would read as a
      // promise about when, which nobody has made.
      response: saved.routing === 'ANSWERED' ? saved.response : null,
    })
  } catch (e) {
    if (isMissingTable(e)) {
      console.error('[bug-reports] sr_bug_reports missing — run scripts/add-bug-reports-table.ts')
      return NextResponse.json({ error: SETUP_HINT }, { status: 503 })
    }
    console.error('[bug-reports] POST failed:', e)
    return NextResponse.json({ error: 'Could not save that — please tell Wes directly.' }, { status: 500 })
  }
}

/**
 * GET — the board (`?scope=all`, ADMIN/MANAGER) or the reporter's own
 * recent reports (default). Everyone can see what happened to what THEY
 * sent; only the people who work the list see everyone's.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const scope = req.nextUrl.searchParams.get('scope') === 'all' ? 'all' : 'mine'
  const canSeeAll = user.role === 'ADMIN' || user.role === 'MANAGER'
  if (scope === 'all' && !canSeeAll) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  try {
    const reports = await prisma.bugReport.findMany({
      where: scope === 'all' ? {} : { reportedById: user.id },
      orderBy: { createdAt: 'desc' },
      take: scope === 'all' ? 300 : 10,
      include: { _count: { select: { duplicates: true } } },
    })
    return NextResponse.json({ reports })
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ reports: [], setupNeeded: true })
    console.error('[bug-reports] GET failed:', e)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
