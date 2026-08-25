import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readPrivateBlobBuffer } from '@/lib/claims/streamBlob'
import { runCoiAiReview } from '@/lib/coi/reviewCoi'
import { evaluateInsuredMatch } from '@/lib/coi/insuredMatch'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET/POST /api/coi/review/[id] — the COI review desk.
 *
 * Until now a certificate could only be signed off at the moment an agent
 * uploaded it (the "verified" checkbox on the upload modal). Anything that
 * arrived any other way — the client's no-login drop link, the portal
 * upload — landed PENDING with no surface anywhere in HQ to approve or
 * reject it. This is that surface's API.
 *
 * GET returns everything the reviewer needs in one call: the file, the AI
 * findings, and the named-insured-vs-production-company comparison.
 * POST records the decision, or re-runs the AI review on a stored file.
 *
 * `review` is a static segment sitting beside the client-facing `[token]`
 * upload route — static wins in Next's matcher, so `/api/coi/review/<id>`
 * never resolves as a token.
 */

const DECISIONS = new Set(['APPROVED', 'REJECTED', 'PENDING'])

/** Names this COI could legitimately be issued to, best first. */
function candidateNames(coi: {
  job: { name: string; company: { name: string } | null } | null
  company: { name: string } | null
}): string[] {
  return [coi.job?.company?.name, coi.company?.name, coi.job?.name]
    .filter((n): n is string => !!n && !!n.trim())
    .filter((n, i, arr) => arr.indexOf(n) === i)
}

const coiSelect = {
  id: true,
  originalFilename: true,
  fileSize: true,
  mimeType: true,
  fileUrl: true,
  source: true,
  clientUploaderName: true,
  clientUploaderEmail: true,
  createdAt: true,
  namedInsured: true,
  policyExpiryDate: true,
  coverageVerified: true,
  additionalInsured: true,
  aiRiskLevel: true,
  aiRecommendation: true,
  aiResponse: true,
  humanDecision: true,
  humanDecisionNote: true,
  humanDecisionAt: true,
  deletedAt: true,
  humanDecisionBy: { select: { name: true, email: true } },
  uploadedBy: { select: { name: true } },
  job: {
    select: {
      id: true,
      name: true,
      jobCode: true,
      companyId: true,
      company: { select: { id: true, name: true } },
      orders: {
        orderBy: { createdAt: 'asc' as const },
        select: {
          id: true,
          orderNumber: true,
          signedAgreements: {
            select: { contractType: true, status: true, signedAt: true, signerName: true },
          },
        },
      },
    },
  },
  company: { select: { id: true, name: true } },
} as const

type CoiRow = Awaited<ReturnType<typeof loadCoi>>

async function loadCoi(id: string) {
  return prisma.coiCheck.findUnique({ where: { id }, select: coiSelect })
}

/** One shape, used by both GET and POST so the client never re-fetches. */
function serialize(coi: NonNullable<CoiRow>) {
  const ai = (coi.aiResponse || null) as Record<string, unknown> | null
  const candidates = candidateNames(coi)
  const match = evaluateInsuredMatch(coi.namedInsured, candidates)

  // Agreements already signed under the CURRENT company. Surfaced because a
  // name mismatch that is resolved by changing the production company makes
  // any already-signed agreement the wrong paper — the reviewer needs to
  // know that before they change anything.
  const signedAgreements = (coi.job?.orders ?? []).flatMap((o) =>
    o.signedAgreements
      .filter((a) => !!a.signedAt)
      .map((a) => ({
        orderId: o.id,
        orderNumber: o.orderNumber,
        contractType: a.contractType,
        status: a.status,
        signedAt: a.signedAt,
        signerName: a.signerName,
      })),
  )

  return {
    id: coi.id,
    originalFilename: coi.originalFilename,
    fileSize: coi.fileSize,
    mimeType: coi.mimeType,
    downloadUrl: `/api/coi/download/${coi.id}`,
    source: coi.source,
    uploadedBy:
      coi.source === 'CLIENT_UPLOAD'
        ? coi.clientUploaderName || coi.clientUploaderEmail || 'Client'
        : coi.uploadedBy?.name || null,
    createdAt: coi.createdAt,
    namedInsured: coi.namedInsured,
    policyExpiryDate: coi.policyExpiryDate,
    coverageVerified: coi.coverageVerified,
    additionalInsured: coi.additionalInsured,
    aiRiskLevel: coi.aiRiskLevel,
    aiRecommendation: coi.aiRecommendation,
    aiNotes: typeof ai?.notes === 'string' ? ai.notes : null,
    aiOverallPass: ai?.overallPass === true,
    aiRan: !!coi.aiRiskLevel || !!ai,
    humanDecision: coi.humanDecision,
    humanDecisionNote: coi.humanDecisionNote,
    humanDecisionAt: coi.humanDecisionAt,
    humanDecisionBy: coi.humanDecisionBy?.name || null,
    job: coi.job
      ? { id: coi.job.id, name: coi.job.name, jobCode: coi.job.jobCode, companyId: coi.job.companyId }
      : null,
    companyName: coi.job?.company?.name ?? coi.company?.name ?? null,
    match,
    signedAgreements,
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await params
  const coi = await loadCoi(id)
  if (!coi || coi.deletedAt) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, coi: serialize(coi) })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const reviewer = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })

  const { id } = await params
  const existing = await loadCoi(id)
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown
    decision?: unknown
    note?: unknown
    policyExpiryDate?: unknown
  }
  const action = typeof body.action === 'string' ? body.action : 'DECIDE'
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) || null : null

  // Re-run the AI on the stored file. The path that matters: the client
  // no-login drop stores the PDF WITHOUT a review, so every certificate
  // that came in through the link needs this before it can be judged —
  // including reading the named insured off it.
  if (action === 'RERUN_AI') {
    const buffer = await readPrivateBlobBuffer(existing.fileUrl)
    if (!buffer) {
      return NextResponse.json({ error: 'Could not read the stored file to review it.' }, { status: 502 })
    }
    const ai = await runCoiAiReview(buffer, existing.mimeType || 'application/pdf')
    const aiExpiry =
      typeof ai.policyExpiryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ai.policyExpiryDate)
        ? new Date(ai.policyExpiryDate)
        : null
    await prisma.coiCheck.update({
      where: { id },
      data: {
        aiResponse: ai as object,
        aiRiskLevel: typeof ai.riskLevel === 'string' ? ai.riskLevel : null,
        aiRecommendation: ai.overallPass ? 'accept' : 'review',
        namedInsured:
          typeof ai.namedInsured === 'string' && ai.namedInsured.trim()
            ? ai.namedInsured.trim().slice(0, 300)
            : existing.namedInsured,
        // Never downgrade an expiry a human typed in; only fill a blank.
        ...(existing.policyExpiryDate == null && aiExpiry ? { policyExpiryDate: aiExpiry } : {}),
        // AI never flips additionalInsured off — it only confirms it.
        ...(ai.additionalInsured === true ? { additionalInsured: true } : {}),
      },
    })
    const fresh = await loadCoi(id)
    return NextResponse.json({ ok: true, coi: serialize(fresh!) })
  }

  const decision = typeof body.decision === 'string' ? body.decision.toUpperCase() : ''
  if (!DECISIONS.has(decision)) {
    return NextResponse.json(
      { error: 'decision must be APPROVED, REJECTED or PENDING' },
      { status: 400 },
    )
  }

  let policyExpiryDate: Date | null | undefined
  if (typeof body.policyExpiryDate === 'string') {
    const raw = body.policyExpiryDate.trim()
    if (!raw) {
      policyExpiryDate = null
    } else {
      const d = new Date(raw)
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'Policy expiry date is not a valid date.' }, { status: 400 })
      }
      policyExpiryDate = d
    }
  }

  await prisma.coiCheck.update({
    where: { id },
    data: {
      humanDecision: decision as 'APPROVED' | 'REJECTED' | 'PENDING',
      humanDecisionNote: note,
      humanDecisionById: decision === 'PENDING' ? null : reviewer?.id ?? null,
      humanDecisionAt: decision === 'PENDING' ? null : new Date(),
      // Approving IS the coverage sign-off — the job header reads either
      // flag, and leaving them disagreeing is how a "Verified" badge ends
      // up sitting next to an unreviewed certificate.
      coverageVerified: decision === 'APPROVED',
      ...(policyExpiryDate !== undefined ? { policyExpiryDate } : {}),
    },
  })

  const fresh = await loadCoi(id)
  return NextResponse.json({ ok: true, coi: serialize(fresh!) })
}
