/**
 * GET  /api/portal/job/lcdw — what the damage waiver would cover on this job,
 *                             and what the client has already elected.
 * POST /api/portal/job/lcdw — record the election and file the job addendum.
 *
 * Cookie-auth'd sibling of the legacy /api/portal/[token]/lcdw, which reads a
 * PaperworkRequest token and a BOOKING. This one resolves the
 * JOB_SESSION_COOKIE like every other /api/portal/job route, and answers from
 * the ORDER lines — the anchor an annual account's job actually has.
 *
 * Why the election lives here at all: for a company on an annual agreement
 * the rental agreement is already signed for the year, so the portal has
 * exactly one thing left to ask (Wes, 2026-09-01: "only asked to elect or
 * deny LCDW"). Before this, the job portal had no LCDW surface of any kind —
 * the election existed solely on the old booking-token portal, which annual
 * clients never see.
 *
 * Returns descriptions only: no rates per line, no ids the client has no use
 * for. The $/day rate is stated on the card itself, from the contract
 * constants.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { JOB_SESSION_COOKIE, verifyJobSessionCookieValue } from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { findCompanyAnnualCoverage, annualCoverageTitle } from '@/lib/orders/annualCoverage'
import {
  recordJobLcdwElection,
  summarizeJobLcdwCoverage,
  LCDW_ACKNOWLEDGEMENT_TEXT,
} from '@/lib/lcdw/jobElection'
import { LCDW_ADDENDUM } from '@/lib/contracts/contractClauses'
import { LCDW_DAILY_RATE } from '@/lib/contracts/fees'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function resolve(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) return null
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) return null
  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: { id: true, jobId: true, companyId: true },
  })
  if (!order?.jobId) return null
  return { resolved, jobId: order.jobId, companyId: order.companyId }
}

export async function GET(req: NextRequest) {
  const ctx = await resolve(req)
  if (!ctx) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const [summary, election, coverage] = await Promise.all([
    summarizeJobLcdwCoverage(ctx.jobId),
    prisma.lcdwElection.findUnique({
      where: { jobId: ctx.jobId },
      select: { decision: true, decidedAt: true, signerName: true },
    }),
    ctx.companyId ? findCompanyAnnualCoverage(ctx.companyId) : Promise.resolve(null),
  ])

  return NextResponse.json({
    ratePerDay: LCDW_DAILY_RATE,
    terms: {
      title: LCDW_ADDENDUM.title,
      coverage: LCDW_ADDENDUM.coverage,
      exclusions: LCDW_ADDENDUM.exclusions,
      scope: LCDW_ADDENDUM.scope,
      note: LCDW_ADDENDUM.note,
    },
    acknowledgementText: LCDW_ACKNOWLEDGEMENT_TEXT,
    covered: summary.coveredVehicles,
    excluded: summary.excludedVehicles,
    allExcluded: summary.allExcluded,
    hasVehicles: summary.hasVehicles,
    election: election
      ? {
          decision: election.decision,
          decidedAt: election.decidedAt.toISOString(),
          signerName: election.signerName,
        }
      : null,
    annualAgreement: coverage
      ? { title: annualCoverageTitle(coverage), companyName: coverage.companyName }
      : null,
  })
}

interface ElectBody {
  decision?: unknown
  signerName?: unknown
  signerTitle?: unknown
  signerEmail?: unknown
  signatureImageData?: unknown
}

export async function POST(req: NextRequest) {
  const ctx = await resolve(req)
  if (!ctx) return NextResponse.json({ error: 'No session' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as ElectBody
  const decision = body.decision === 'ACCEPTED' || body.decision === 'DECLINED' ? body.decision : null
  const signerName = typeof body.signerName === 'string' ? body.signerName.trim() : ''
  if (!decision) {
    return NextResponse.json({ error: 'Choose accept or decline' }, { status: 400 })
  }
  if (!signerName) {
    // Both directions are signed. A DECLINE is the half we would actually
    // have to prove — "we asked and they said no" is worth nothing without
    // the name attached to it.
    return NextResponse.json({ error: 'Type your name to confirm' }, { status: 400 })
  }

  // Accepting a waiver that covers nothing on this job takes money for
  // coverage that does not exist. The same refusal /api/orders/[id]/lcdw
  // makes on the staff side, made here before the client can commit.
  if (decision === 'ACCEPTED') {
    const summary = await summarizeJobLcdwCoverage(ctx.jobId)
    if (summary.allExcluded || summary.coveredVehicles.length === 0) {
      return NextResponse.json(
        {
          error:
            'The damage waiver is not available on this job — none of the vehicles booked are eligible. Nothing to elect.',
        },
        { status: 409 },
      )
    }
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null

  const { election, addendumId } = await recordJobLcdwElection({
    jobId: ctx.jobId,
    decision,
    signerName,
    signerTitle: typeof body.signerTitle === 'string' ? body.signerTitle.trim() || null : null,
    signerEmail:
      (typeof body.signerEmail === 'string' ? body.signerEmail.trim() : '') ||
      ctx.resolved.contact?.email ||
      null,
    signatureData:
      typeof body.signatureImageData === 'string' ? body.signatureImageData : null,
    ipAddress: ip,
    userAgent: req.headers.get('user-agent'),
    source: 'PORTAL_JOB',
  })

  return NextResponse.json({
    ok: true,
    decision: election.decision,
    decidedAt: election.decidedAt.toISOString(),
    // Only true when the addendum actually got filed — the client is told
    // "added to your file" only when it is.
    addendumFiled: !!addendumId,
  })
}
