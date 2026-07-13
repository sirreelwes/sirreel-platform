import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { sendStageReadyToSignEmail } from '@/lib/paperwork/stageReadyEmail'
import {
  STAGE_AREA_KEYS,
  STRYKER_TRIGGER_KEY,
  normalizeComplexAreas,
  stageTermsReady,
  ledWallSelected,
} from '@/lib/contracts/stageAreas'

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
      termsReady: stageTermsReady(sd),
      strykerRequired: sets.includes(STRYKER_TRIGGER_KEY),
      readyToSignEmailSentAt: sd?.readyToSignEmailSentAt || null,
      complexAreas: normalizeComplexAreas(sd?.complexAreas),
      signoff: sd?.signoff
        ? {
            signerName: sd.signoff.signerName || '',
            signedAt: sd.signoff.signedAt || '',
            strykerSigned: !!sd.signoff.stryker,
            signedPdfUrl: sd.signoff.signedPdfUrl || null,
          }
        : null,
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
    const wasReady = stageTermsReady(existing)

    const next: any = { ...existing }
    if (Array.isArray(body.sets)) next.sets = body.sets.filter((s: any) => typeof s === 'string' && STAGE_AREA_KEYS.includes(s))
    if (Array.isArray(body.prelitSets)) {
      next.prelitSets = body.prelitSets.filter((s: any) => typeof s === 'string' && (next.sets || []).includes(s))
    }
    for (const f of STRING_FIELDS) {
      if (typeof body[f] === 'string') next[f] = body[f].slice(0, 2000)
    }
    // Complex amenities (included/not-included toggles, no fees) —
    // normalized so the standing list is always complete and custom
    // entries are capped/sanitized.
    if (Array.isArray(body.complexAreas)) next.complexAreas = normalizeComplexAreas(body.complexAreas)

    // Scheduled dates per day type — count-driven date pickers in the
    // editor. Each entry is a yyyy-mm-dd string (or '' for an unpicked
    // slot); counts stay the manual source of truth for how many slots
    // exist. Purely descriptive schedule data — no gate impact.
    if (body.dayDates && typeof body.dayDates === 'object') {
      const clean: Record<string, string[]> = {}
      for (const k of ['prep', 'shoot', 'strike', 'dark']) {
        const arr = (body.dayDates as any)[k]
        if (Array.isArray(arr)) {
          clean[k] = arr
            .slice(0, 60)
            .map((d: any) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''))
        }
      }
      next.dayDates = clean
    }

    // LED Wall add-on (sub-option of Lankershim Studio) + required tech fork.
    if (typeof body.ledWall === 'boolean') next.ledWall = body.ledWall
    if (body.ledWallTech === 'sirreel' || body.ledWallTech === 'client') next.ledWallTech = body.ledWallTech
    else if (body.ledWallTech === '' || body.ledWallTech === null) delete next.ledWallTech

    // LED Wall PO marker — NON-MONETARY flag only (no payable, no invoice
    // line, no price change). Lives here so the future Payables system can
    // pick it up off stageDetails. Set once while the LED Wall is on;
    // removed if the LED Wall is turned off before signing.
    if (ledWallSelected(next)) {
      next.ledWallPo = next.ledWallPo || {
        kind: 'LED_WALL_PO_PLACEHOLDER',
        amountUsd: 1000,
        owedTo: 'Angelo Belarmino / XR Stages',
        note: '$1,000 LED Wall purchase order owed — placeholder flag for the future Payables system. Not a payable, not billed.',
        flaggedAt: new Date().toISOString(),
      }
    } else {
      delete next.ledWallPo
    }

    await prisma.paperworkRequest.update({
      where: { token: params.token },
      data: { stageDetails: JSON.stringify(next) },
    })

    const sets: string[] = next.sets || []
    const termsReady = stageTermsReady(next)

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
      complexAreas: normalizeComplexAreas(next.complexAreas),
      stageDetails: next,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
