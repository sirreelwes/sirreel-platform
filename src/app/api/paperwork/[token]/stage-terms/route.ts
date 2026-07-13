import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { sendStageReadyToSignEmail } from '@/lib/paperwork/stageReadyEmail'
import { STAGE_AREA_KEYS, STRYKER_TRIGGER_KEY } from '@/lib/contracts/stageAreas'

export const dynamic = 'force-dynamic'

/**
 * Agent-side stage-terms preparation for a paperwork request.
 *
 * Stage rates and areas are negotiated per job, so before a client can
 * sign the studio contract a SirReel agent must set them here. The v2
 * portal's studio card (and its /api/portal/v2/[token]/stage-sign
 * endpoint) stay gated until sets + ratePerDay exist.
 *
 * GET  → current terms + signable/signed state (agent view)
 * PUT  → upsert the negotiated terms into PaperworkRequest.stageDetails
 *        (merged, preserving any client `signoff`; blocked after signing)
 */

const STRING_FIELDS = ['ratePerDay', 'otRate', 'prepDays', 'shootDays', 'strikeDays', 'darkDays', 'notes'] as const

async function requireAgent() {
  const session = await getServerSession()
  if (!session?.user?.email) return null
  return session
}

function parseDetails(raw: string | null): any {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  if (!(await requireAgent())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const request = await prisma.paperworkRequest.findUnique({
      where: { token: params.token },
      include: { booking: { select: { jobName: true, startDate: true, endDate: true, company: { select: { name: true } } } } },
    })
    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const sd = parseDetails(request.stageDetails)
    const sets: string[] = Array.isArray(sd?.sets) ? sd.sets : []
    return NextResponse.json({
      contractType: request.contractType,
      studioContractSigned: request.studioContractSigned,
      termsReady: sets.length > 0 && !!sd?.ratePerDay,
      strykerRequired: sets.includes(STRYKER_TRIGGER_KEY),
      readyToSignEmailSentAt: sd?.readyToSignEmailSentAt || null,
      stageDetails: sd,
      booking: request.booking,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: { token: string } }) {
  if (!(await requireAgent())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const request = await prisma.paperworkRequest.findUnique({ where: { token: params.token } })
    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (request.studioContractSigned) {
      return NextResponse.json({ error: 'Studio contract already signed — terms are locked' }, { status: 409 })
    }

    const body = await req.json().catch(() => ({}))
    const existing = parseDetails(request.stageDetails) || {}
    const existingSets: string[] = Array.isArray(existing.sets) ? existing.sets : []
    const wasReady = existingSets.length > 0 && !!existing.ratePerDay

    const next: any = { ...existing }
    if (Array.isArray(body.sets)) next.sets = body.sets.filter((s: any) => typeof s === 'string' && STAGE_AREA_KEYS.includes(s))
    if (Array.isArray(body.prelitSets)) {
      next.prelitSets = body.prelitSets.filter((s: any) => typeof s === 'string' && (next.sets || []).includes(s))
    }
    for (const f of STRING_FIELDS) {
      if (typeof body[f] === 'string') next[f] = body[f].slice(0, 2000)
    }

    await prisma.paperworkRequest.update({
      where: { token: params.token },
      data: { stageDetails: JSON.stringify(next) },
    })

    const sets: string[] = next.sets || []
    const termsReady = sets.length > 0 && !!next.ratePerDay

    // Client notification: fires on the FIRST not-signable → signable
    // transition only. The helper independently guards on the persisted
    // readyToSignEmailSentAt stamp (and on already-signed / missing
    // email), so later re-saves never re-send.
    let readyEmail: { sent: boolean; to?: string; sentAt?: string; reason?: string } | null = null
    if (!wasReady && termsReady) {
      readyEmail = await sendStageReadyToSignEmail(params.token)
    }

    return NextResponse.json({
      ok: true,
      termsReady,
      strykerRequired: sets.includes(STRYKER_TRIGGER_KEY),
      readyEmail,
      readyToSignEmailSentAt: readyEmail?.sentAt || next.readyToSignEmailSentAt || null,
      stageDetails: next,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
