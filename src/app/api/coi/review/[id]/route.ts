import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rerunCoiAiReview } from '@/lib/coi/rerunCoiReview'
import { evaluateInsuredMatch } from '@/lib/coi/insuredMatch'
import { buildCoiFixDraft } from '@/lib/coi/fixRequest'
import { signCoiToken } from '@/lib/coi/coiUploadToken'
import { coiUploadUrl } from '@/lib/portal/portalUrl'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

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

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

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
      // Recipients for "Request fix" — the certificate is the client's to
      // correct, so the ask goes to the job's contacts (primary first).
      jobContacts: {
        select: {
          role: true,
          isPrimary: true,
          person: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
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

  // Who the "what's still missing" note should go to. The person who
  // actually sent the certificate wins — they are the one talking to the
  // broker — then the job's primary contact, then anyone else on the job.
  const contacts: { name: string; email: string; role: string | null }[] = []
  const seenEmail = new Set<string>()
  const pushContact = (name: string, email: string | null | undefined, role: string | null) => {
    const e = (email || '').trim()
    if (!e || seenEmail.has(e.toLowerCase())) return
    seenEmail.add(e.toLowerCase())
    contacts.push({ name: name.trim() || e, email: e, role })
  }
  if (coi.source === 'CLIENT_UPLOAD') {
    pushContact(coi.clientUploaderName || 'Uploader', coi.clientUploaderEmail, 'Sent this certificate')
  }
  for (const jc of [...(coi.job?.jobContacts ?? [])].sort(
    (a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary),
  )) {
    pushContact(`${jc.person.firstName} ${jc.person.lastName}`, jc.person.email, jc.role)
  }

  const uploadUrl =
    coi.job || coi.company
      ? coiUploadUrl(
          signCoiToken({
            jobId: coi.job?.id,
            companyId: coi.job?.companyId ?? coi.company?.id ?? undefined,
          }),
        )
      : null

  const fixDraft = buildCoiFixDraft({
    ai: ai as Parameters<typeof buildCoiFixDraft>[0]['ai'],
    match,
    policyExpiryDate: coi.policyExpiryDate,
    jobName: coi.job?.name ?? null,
    uploadUrl,
    contactFirstName: contacts[0]?.name?.split(' ')[0] ?? null,
  })

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
    // Whether the STORED review was produced by a prompt that asked for the
    // named insured at all. Reviews filed before the field existed have no
    // such key, so their blank insured name is "never looked" — not "looked
    // and found nothing". The modal says so rather than offering a bare
    // "Re-run" that reads as redundant.
    aiHasInsuredName: !!ai && Object.prototype.hasOwnProperty.call(ai, 'namedInsured'),
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
    contacts,
    fixDraft,
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
    to?: unknown
    message?: unknown
  }
  const action = typeof body.action === 'string' ? body.action : 'DECIDE'
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) || null : null

  // Re-run the AI on the stored file. The path that matters: the client
  // no-login drop stores the PDF WITHOUT a review, so every certificate
  // that came in through the link needs this before it can be judged —
  // including reading the named insured off it.
  if (action === 'RERUN_AI') {
    const outcome = await rerunCoiAiReview(id)
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.error === 'not found' ? 404 : 502 })
    }
    const fresh = await loadCoi(id)
    return NextResponse.json({ ok: true, coi: serialize(fresh!) })
  }

  // Ask the client to fix it — the third option beside Approve/Reject.
  // Rejecting told the CLIENT nothing; someone then hand-wrote an email
  // reconstructing which checks failed. This sends the reviewer's edited
  // draft and parks the row in COUNTERED ("changes requested") so the desk
  // can tell "nobody has looked" from "we asked, we're waiting on them".
  if (action === 'REQUEST_FIX') {
    const to = typeof body.to === 'string' ? body.to.trim() : ''
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return NextResponse.json({ error: 'A valid client email is required.' }, { status: 400 })
    }
    if (!message) {
      return NextResponse.json({ error: 'The message cannot be empty.' }, { status: 400 })
    }

    const jobLabel = existing.job ? `${existing.job.name} (${existing.job.jobCode})` : null
    const sent = await sendAgreementEmail({
      to: [to],
      // Replies belong with the reviewer, not notifications@ — they are the
      // one who read the certificate and can answer the broker's question.
      replyTo: session.user.email,
      subject: jobLabel
        ? `Certificate of insurance — more needed for ${jobLabel}`
        : 'Certificate of insurance — more needed',
      label: 'coi-request-fix',
      // The reviewer sends exactly what they read in the box: escape it and
      // keep the line breaks rather than re-rendering from the draft, or the
      // email and the audit note drift apart.
      html: `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(
        message,
      )}</div>`,
      text: message,
    })
    if (!sent.ok) {
      return NextResponse.json(
        { error: `The email did not send (${sent.reason}). Nothing was changed.` },
        { status: 502 },
      )
    }

    await prisma.coiCheck.update({
      where: { id },
      data: {
        humanDecision: 'COUNTERED',
        humanDecisionById: reviewer?.id ?? null,
        humanDecisionAt: new Date(),
        // Never a sign-off: a certificate we asked to have corrected is not
        // verified coverage.
        coverageVerified: false,
        humanDecisionNote: note || `Fix requested — emailed ${to}.`,
      },
    })
    const after = await loadCoi(id)
    return NextResponse.json({ ok: true, coi: serialize(after!), sentTo: to })
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
