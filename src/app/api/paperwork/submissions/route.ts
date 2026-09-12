import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { evaluateInsuredMatch, INSURED_MATCH_LABEL } from '@/lib/coi/insuredMatch'
import {
  coiNeedsReview,
  dismissalKey,
  loadDismissals,
  type DismissalInfo,
} from '@/lib/paperwork/reviewQueue'

export const dynamic = 'force-dynamic'

/**
 * GET /api/paperwork/submissions?limit=50
 *
 * One reverse-chronological feed of every client paperwork submission,
 * across all jobs. Paperwork already lives on the job detail page, but
 * only if you already know WHICH job — this is the "did that COI ever
 * land?" lookup the team was doing by opening jobs one at a time.
 *
 * Five sources, deliberately merged in application code rather than SQL:
 * they live on three different tables hanging off three different roots
 * (CoiCheck → Job, PaperworkRequest → Booking, SignedAgreement → Order),
 * and a UNION would have to hand-roll the job resolution each source
 * already gets from Prisma relations.
 *
 * NEVER returns card data. A credit-card authorization row says that an
 * authorization was signed and who signed it — no card type, no last4,
 * and obviously no token. Collections' own surface
 * (/api/collections/authorizations) is where charging happens, behind
 * requireCollectionsUser; this feed is a findability index for everyone.
 */

export type SubmissionKind =
  | 'COI'
  | 'WC'
  | 'CC_AUTH'
  | 'AGREEMENT'
  | 'CONTRACT_REVIEW'
  | 'REDLINE'

export interface PaperworkSubmission {
  key: string
  /** Row id within its own table — what the review surface opens. */
  sourceId: string
  kind: SubmissionKind
  label: string
  detail: string | null
  submittedAt: string
  submittedBy: string | null
  jobId: string | null
  jobCode: string | null
  jobName: string | null
  companyName: string | null
  href: string | null
  /** Session-gated proxy URL for the document itself, when this kind of
   *  submission HAS a stored file the feed can serve. Null means there is
   *  nothing to open — a card authorization is a signing event, not a
   *  document, and an agreement can be signed with no executed PDF filed. */
  documentHref: string | null
  /** Same document, attachment disposition. */
  downloadHref: string | null
  /** Review state, for the kinds that HAVE a review (COI today). */
  reviewState: 'PENDING' | 'APPROVED' | 'COUNTERED' | 'REJECTED' | null
  /** Set when this submission needs a human to look at it for a reason
   *  the feed can state in a few words — currently a COI whose named
   *  insured doesn't match the production company. The feed doubles as a
   *  triage queue, so the finding belongs in the row, not only behind a
   *  click. */
  flag: { label: string; detail: string } | null
  /** True while this row is still asking for a human — see
   *  src/lib/paperwork/reviewQueue.ts. What the nav badge counts. */
  needsReview: boolean
  /** Set once someone skipped it: who, when, why. A skip suppresses the
   *  alert and nothing else — the document's own state is untouched. */
  dismissal: DismissalInfo | null
}

// Where on the job page this kind of paperwork is reviewed. Anchors are
// the section ids in src/app/(dashboard)/jobs/[id]/page.tsx.
const ANCHOR: Record<SubmissionKind, string> = {
  COI: '#coi',
  WC: '#wc',
  CC_AUTH: '#card-auth',
  AGREEMENT: '#agreement',
  // A contract review is opened on the review desk itself, not on the job
  // — see the override in the CONTRACT_REVIEW loop below.
  CONTRACT_REVIEW: '#agreement',
  REDLINE: '#agreement',
}

function jobHref(kind: SubmissionKind, jobId: string | null): string | null {
  return jobId ? `/jobs/${jobId}${ANCHOR[kind]}` : null
}

/** How long a skipped row stays pinned to the feed so its Undo is reachable. */
const SKIP_VISIBLE_DAYS = 14

function fullName(first?: string | null, last?: string | null): string | null {
  return [first, last].filter(Boolean).join(' ').trim() || null
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const limit = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '50', 10) || 50))

  // Each source is capped at `limit` on its own: the merged feed can only
  // ever need `limit` rows from any single source, and over-fetching all
  // five to get 50 merged rows is the cheapest correct thing.
  const jobSelect = { id: true, name: true, jobCode: true } as const

  // PaperworkRequest is booking-scoped and carries three of the five kinds
  // (WC, card auth, redline). Job resolution mirrors
  // /api/collections/authorizations: Booking.job is the newer direct FK,
  // legacy Planyo bookings only reach a Job through their Order.
  const paperworkSelect = {
    id: true,
    sentTo: true,
    signerName: true,
    booking: {
      select: {
        id: true,
        job: { select: jobSelect },
        orders: {
          orderBy: { createdAt: 'asc' as const },
          take: 1,
          select: { job: { select: jobSelect } },
        },
      },
    },
  }

  type PaperworkRow = {
    booking: {
      job: { id: string; name: string; jobCode: string } | null
      orders: { job: { id: string; name: string; jobCode: string } | null }[]
    } | null
  }
  const paperworkJob = (r: PaperworkRow) => r.booking?.job ?? r.booking?.orders?.[0]?.job ?? null

  const coiSelect = {
    id: true,
    originalFilename: true,
    createdAt: true,
    source: true,
    clientUploaderName: true,
    humanDecision: true,
    namedInsured: true,
    job: { select: { ...jobSelect, company: { select: { name: true } } } },
    company: { select: { name: true } },
    uploadedBy: { select: { name: true } },
  } as const

  const [cois, openCois, wcs, ccAuths, agreements, contractReviews, redlines, dismissals] =
    await Promise.all([
    prisma.coiCheck.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: coiSelect,
    }),
    // The recent window is not enough for the ones that still need a
    // verdict: 41 certificates sat PENDING on 2026-09-11, and the oldest
    // was three months back — outside any window this page would render.
    // The nav badge counts the whole backlog, so the feed has to be able
    // to SHOW the whole backlog; a number you cannot click to is a number
    // nobody can clear. `namedInsured` is pulled in because the mismatch
    // flag is computed, not stored (src/lib/coi/insuredMatch.ts) — those
    // rows are narrowed below.
    prisma.coiCheck.findMany({
      where: {
        deletedAt: null,
        OR: [{ humanDecision: 'PENDING' }, { namedInsured: { not: null } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: coiSelect,
    }),
    prisma.paperworkRequest.findMany({
      // wcFileUrl (not wcReceived) decides: legacy rows carry wcReceived=true
      // from the window when the upload route stored nothing (see schema note
      // on wcFileKey). Those have no document to review.
      where: { wcFileUrl: { not: null } },
      orderBy: { wcUploadedAt: 'desc' },
      take: limit,
      select: { ...paperworkSelect, wcOriginalFilename: true, wcUploadedAt: true, wcAiReview: true },
    }),
    prisma.paperworkRequest.findMany({
      where: { ccAuthSignedAt: { not: null } },
      orderBy: { ccAuthSignedAt: 'desc' },
      take: limit,
      select: {
        ...paperworkSelect,
        ccAuthSignedAt: true,
        ccCardholderFirst: true,
        ccCardholderLast: true,
      },
    }),
    prisma.signedAgreement.findMany({
      where: { signedAt: { not: null } },
      orderBy: { signedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        contractType: true,
        signedAt: true,
        signerName: true,
        signerEmail: true,
        signedDocumentUrl: true,
        order: { select: { id: true, orderNumber: true, job: { select: jobSelect } } },
      },
    }),
    // Client redlines on the review desk. These are the OTHER half of
    // "something to review" and were missing from this feed entirely —
    // ten of them were sitting PENDING, findable only by remembering the
    // Contract Review History page existed.
    prisma.contractReview.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: Math.max(limit, 200),
      select: {
        id: true,
        originalFilename: true,
        createdAt: true,
        humanDecision: true,
        aiRiskLevel: true,
        job: { select: jobSelect },
        company: { select: { name: true } },
        uploadedBy: { select: { name: true } },
      },
    }),
    prisma.paperworkRequest.findMany({
      where: { contract_redline_uploaded_at: { not: null } },
      orderBy: { contract_redline_uploaded_at: 'desc' },
      take: limit,
      select: { ...paperworkSelect, contract_redline_uploaded_at: true, contract_redline_status: true },
    }),
    loadDismissals(),
  ])

  const dismissalFor = (kind: SubmissionKind, id: string): DismissalInfo | null =>
    dismissals.get(dismissalKey(kind, id)) ?? null

  const submissions: PaperworkSubmission[] = []

  // Recent window ∪ still-open, deduped by id.
  const coiRows = [...cois, ...openCois].filter(
    (c, i, arr) => arr.findIndex((o) => o.id === c.id) === i,
  )

  for (const c of coiRows) {
    // Named-insured vs production company. Computed here rather than read
    // off a stored verdict so a corrected production company clears the
    // flag on the next load — see src/lib/coi/insuredMatch.ts.
    const match = evaluateInsuredMatch(c.namedInsured, [
      c.job?.company?.name,
      c.company?.name,
      c.job?.name,
    ])
    const coiFlag = match.needsAttention
      ? { label: INSURED_MATCH_LABEL[match.verdict], detail: match.message }
      : null
    const coiDismissal = dismissalFor('COI', c.id)
    submissions.push({
      key: `COI:${c.id}`,
      sourceId: c.id,
      kind: 'COI',
      label: 'Certificate of Insurance',
      detail: c.originalFilename || null,
      submittedAt: c.createdAt.toISOString(),
      submittedBy:
        c.source === 'CLIENT_UPLOAD' ? c.clientUploaderName || 'Client' : c.uploadedBy?.name || null,
      jobId: c.job?.id ?? null,
      jobCode: c.job?.jobCode ?? null,
      jobName: c.job?.name ?? null,
      companyName: c.company?.name ?? null,
      href: jobHref('COI', c.job?.id ?? null),
      documentHref: null,
      downloadHref: null,
      // COUNTERED = the desk emailed a fix request and is waiting on the
      // broker. It was cast away here and painted REJECTED downstream.
      reviewState: c.humanDecision as 'PENDING' | 'APPROVED' | 'COUNTERED' | 'REJECTED',
      flag: coiFlag,
      needsReview: !coiDismissal && coiNeedsReview(c.humanDecision, !!coiFlag),
      dismissal: coiDismissal,
    })
  }

  for (const w of wcs) {
    const job = paperworkJob(w)
    submissions.push({
      key: `WC:${w.id}`,
      sourceId: w.id,
      kind: 'WC',
      label: 'Workers’ Comp certificate',
      detail: w.wcOriginalFilename || null,
      // wcUploadedAt is nullable in the schema; every row we selected has a
      // file, but a legacy row could have the file without the stamp.
      submittedAt: (w.wcUploadedAt ?? new Date(0)).toISOString(),
      submittedBy: w.signerName || w.sentTo || null,
      jobId: job?.id ?? null,
      jobCode: job?.jobCode ?? null,
      jobName: job?.name ?? null,
      companyName: null,
      href: jobHref('WC', job?.id ?? null),
      documentHref: null,
      downloadHref: null,
      reviewState: null,
      flag: null,
      needsReview: false,
      dismissal: null,
    })
  }

  for (const a of ccAuths) {
    const job = paperworkJob(a)
    submissions.push({
      key: `CC_AUTH:${a.id}`,
      sourceId: a.id,
      kind: 'CC_AUTH',
      label: 'Credit card authorization',
      // Deliberately says what it is and nothing about the card.
      detail: 'Card on file — details not shown',
      submittedAt: (a.ccAuthSignedAt as Date).toISOString(),
      submittedBy: fullName(a.ccCardholderFirst, a.ccCardholderLast) || a.signerName || null,
      jobId: job?.id ?? null,
      jobCode: job?.jobCode ?? null,
      jobName: job?.name ?? null,
      companyName: null,
      href: jobHref('CC_AUTH', job?.id ?? null),
      documentHref: null,
      downloadHref: null,
      reviewState: null,
      flag: null,
      needsReview: false,
      dismissal: null,
    })
  }

  for (const s of agreements) {
    // The executed PDF, served through the order's session-gated proxy.
    // Without this the feed's only offer was "go look at the job", and the
    // job page's agreement section doesn't even list order-signed
    // agreements — so a signed contract in this list was unreachable from
    // the one screen built to find it.
    const agreementDoc =
      s.signedDocumentUrl && s.order?.id
        ? `/api/orders/${s.order.id}/agreement/pdf?type=${s.contractType}&doc=signed`
        : null
    submissions.push({
      key: `AGREEMENT:${s.id}`,
      sourceId: s.id,
      kind: 'AGREEMENT',
      label: s.contractType === 'STAGE_CONTRACT' ? 'Stage contract' : 'Rental agreement',
      detail: s.order?.orderNumber ? `Order ${s.order.orderNumber}` : null,
      submittedAt: (s.signedAt as Date).toISOString(),
      submittedBy: s.signerName || s.signerEmail || null,
      jobId: s.order?.job?.id ?? null,
      jobCode: s.order?.job?.jobCode ?? null,
      jobName: s.order?.job?.name ?? null,
      companyName: null,
      href: jobHref('AGREEMENT', s.order?.job?.id ?? null),
      documentHref: agreementDoc,
      downloadHref: agreementDoc ? `${agreementDoc}&download=1` : null,
      reviewState: null,
      flag: null,
      needsReview: false,
      dismissal: null,
    })
  }

  for (const cr of contractReviews) {
    // The redline desk is where this one is actually judged — a job anchor
    // would land the reviewer on a page that says a review exists and
    // gives them no way to read it.
    const crDismissal = dismissalFor('CONTRACT_REVIEW', cr.id)
    submissions.push({
      key: `CONTRACT_REVIEW:${cr.id}`,
      sourceId: cr.id,
      kind: 'CONTRACT_REVIEW',
      label: 'Client redline',
      detail: cr.originalFilename || null,
      submittedAt: cr.createdAt.toISOString(),
      submittedBy: cr.uploadedBy?.name || null,
      jobId: cr.job?.id ?? null,
      jobCode: cr.job?.jobCode ?? null,
      jobName: cr.job?.name ?? null,
      companyName: cr.company?.name ?? null,
      href: `/tools/contract-review/${cr.id}`,
      documentHref: null,
      downloadHref: null,
      reviewState: cr.humanDecision === 'PENDING' ? 'PENDING' : null,
      flag: null,
      needsReview: !crDismissal && cr.humanDecision === 'PENDING',
      dismissal: crDismissal,
    })
  }

  for (const r of redlines) {
    const job = paperworkJob(r)
    const rDismissal = dismissalFor('REDLINE', r.id)
    submissions.push({
      key: `REDLINE:${r.id}`,
      sourceId: r.id,
      kind: 'REDLINE',
      label: 'Contract redline',
      detail:
        r.contract_redline_status === 'pending_review'
          ? 'Awaiting review'
          : r.contract_redline_status || null,
      submittedAt: (r.contract_redline_uploaded_at as Date).toISOString(),
      submittedBy: r.signerName || r.sentTo || null,
      jobId: job?.id ?? null,
      jobCode: job?.jobCode ?? null,
      jobName: job?.name ?? null,
      companyName: null,
      href: jobHref('REDLINE', job?.id ?? null),
      documentHref: null,
      downloadHref: null,
      reviewState: r.contract_redline_status === 'pending_review' ? 'PENDING' : null,
      flag: null,
      needsReview: !rDismissal && r.contract_redline_status === 'pending_review',
      dismissal: rDismissal,
    })
  }

  submissions.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))

  // Everything still asking for a human, plus the recent window. The cap
  // applies to the RECENT half only: truncating the open half would hide
  // work the nav badge is still counting, which is the one thing this feed
  // must never do.
  //
  // Just-skipped rows are pinned the same way for a fortnight. A skip on a
  // three-month-old certificate would otherwise drop it straight out of the
  // window it was skipped in — the row vanishes mid-click and its Undo goes
  // with it. After that they fall back to the recent window like anything
  // else; the queue is meant to shrink, not to accumulate a skipped pile.
  const skipVisibleSince = Date.now() - SKIP_VISIBLE_DAYS * 86400_000
  const pinned = submissions.filter(
    (r) => r.needsReview || (r.dismissal && Date.parse(r.dismissal.at) >= skipVisibleSince),
  )
  const rest = submissions.filter((r) => !pinned.includes(r)).slice(0, limit)
  const open = pinned
  const rows = [...open, ...rest].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))

  return NextResponse.json({
    ok: true,
    submissions: rows,
    // What the nav badge shows, so the page never disagrees with it.
    reviewCount: submissions.filter((r) => r.needsReview).length,
  })
}
