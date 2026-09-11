/**
 * The production company's certificates of insurance, as the CLIENT sees
 * them in the account portal. Shared by the portal page, HQ's "see what they
 * see" preview and the upload route, so the three never disagree about what
 * a client is shown.
 *
 * Wes 2026-09-11: "for the client portal, I need a way for them to upload
 * COI. This should always be an option for them — 'Upload a COI for your
 * teams'." An account certificate is what the carry-forward in
 * src/lib/coi/companyCoi.ts spreads to every show, so the account portal is
 * where an executive or an accounting seat files it once.
 *
 * ── What a client may read here ────────────────────────────────────────
 * The decision and the dates — never the AI's findings, risk level or the
 * reviewer's note. Those are HQ's working papers; a client told "risk:
 * medium" by a model has been told nothing they can act on.
 *
 * ── The one rule the wording must keep ─────────────────────────────────
 * "Covers your shows" is said ONLY about a certificate that actually carries
 * forward: APPROVED, dated, and not yet expired (rules 1 and 3 of
 * companyCoi.ts). A certificate still in review is "with SirReel for
 * review" — never coverage, however clean it looks.
 */
import type { ReviewDecision } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { coiDocumentKind, type CoiDocumentKind } from '@/lib/coi/coverageKind'

export type ClientCoiStatus = 'ACCEPTED' | 'IN_REVIEW' | 'NOT_ACCEPTED' | 'EXPIRED'

export interface ClientCoiRow {
  id: string
  filename: string
  uploadedAt: string
  /** The person who uploaded it from a portal or drop link; null when HQ
   *  filed it (staff upload, the email harvest). */
  uploadedBy: string | null
  namedInsured: string | null
  policyExpiry: string | null
  status: ClientCoiStatus
  /** A full certificate, or workers' comp on its own (lib/coi/coverageKind). */
  kind: CoiDocumentKind
  /** Approved, dated, unexpired and a full certificate. Workers' comp alone
   *  is never "covers your shows" — it insures their crew, not our gear. */
  coversShows: boolean
}

export interface RawAccountCoi {
  id: string
  originalFilename: string
  createdAt: Date
  source: string | null
  clientUploaderName: string | null
  namedInsured: string | null
  policyExpiryDate: Date | null
  humanDecision: ReviewDecision | string
  aiResponse?: unknown
}

const normName = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const sameDay = (a: Date | null, b: Date | null) =>
  !!a && !!b && a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10)

/** Same policy: same kind, same named insured, same expiry day. */
function samePolicy(
  a: { kind: CoiDocumentKind; namedInsured: string | null; policyExpiryDate: Date | null },
  b: { kind: CoiDocumentKind; namedInsured: string | null; policyExpiryDate: Date | null },
): boolean {
  return (
    a.kind === b.kind &&
    normName(a.namedInsured) !== '' &&
    normName(a.namedInsured) === normName(b.namedInsured) &&
    sameDay(a.policyExpiryDate, b.policyExpiryDate)
  )
}

/** How long a declined certificate stays listed — long enough for the
 *  client to see it was declined and send the right one, not forever. */
const NOT_ACCEPTED_DAYS = 60
const MAX_ROWS = 8

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** Expiry dates are calendar dates: a policy through Oct 1 covers Oct 1. */
function isExpired(expiry: Date | null, now: Date): boolean {
  return !!expiry && expiry.getTime() < startOfUtcDay(now).getTime()
}

export function clientCoiStatus(c: Pick<RawAccountCoi, 'humanDecision' | 'policyExpiryDate'>, now: Date): ClientCoiStatus {
  if (c.humanDecision === 'REJECTED') return 'NOT_ACCEPTED'
  if (isExpired(c.policyExpiryDate, now)) return 'EXPIRED'
  if (c.humanDecision === 'APPROVED') return 'ACCEPTED'
  // PENDING and COUNTERED — a human has not signed it off.
  return 'IN_REVIEW'
}

const STATUS_ORDER: Record<ClientCoiStatus, number> = {
  // What they just sent sits on top, so the uploader sees it land.
  IN_REVIEW: 0,
  ACCEPTED: 1,
  NOT_ACCEPTED: 2,
  EXPIRED: 3,
}

/**
 * Which of the account's certificates the client is shown, in order.
 *
 * Current ones (in review, accepted) always; a declined one for
 * NOT_ACCEPTED_DAYS; an expired one only when nothing current is on file —
 * then the newest lapsed policy is the useful fact ("send the renewal"),
 * and a stack of old ones is not.
 *
 * A copy of an ACCEPTED policy that is itself still in review or declined is
 * not shown. Happy Place, 2026-09-11: Birdie's certificate was uploaded
 * twice, two minutes apart, and only the second approved — the client saw
 * the same policy twice, once "with SirReel for review", which reads as
 * something still outstanding when nothing is.
 */
export function selectClientCois(rows: RawAccountCoi[], now: Date): ClientCoiRow[] {
  const cutoff = now.getTime() - NOT_ACCEPTED_DAYS * 86_400_000
  const all = rows.map((r) => {
    const status = clientCoiStatus(r, now)
    const kind = coiDocumentKind(r.aiResponse)
    return {
      raw: r,
      row: {
        id: r.id,
        filename: r.originalFilename,
        uploadedAt: r.createdAt.toISOString(),
        uploadedBy: r.source === 'CLIENT_UPLOAD' ? r.clientUploaderName : null,
        namedInsured: r.namedInsured,
        policyExpiry: r.policyExpiryDate ? r.policyExpiryDate.toISOString() : null,
        status,
        kind,
        coversShows: status === 'ACCEPTED' && !!r.policyExpiryDate && kind === 'COI',
      } satisfies ClientCoiRow,
    }
  })
  // Newest first, so the copy kept of a twice-accepted policy is the latest.
  const acceptedPolicies = all
    .filter((m) => m.row.status === 'ACCEPTED')
    .sort((a, b) => b.raw.createdAt.getTime() - a.raw.createdAt.getTime())
  const mapped = all.filter((m) => {
    const twin = acceptedPolicies.find(
      (a) => a !== m && samePolicy({ ...a.raw, kind: a.row.kind }, { ...m.raw, kind: m.row.kind }),
    )
    if (!twin) return true
    if (m.row.status !== 'ACCEPTED') return false
    // Both accepted (Happy Place again, once the copy was approved too): one row.
    return acceptedPolicies.indexOf(m) < acceptedPolicies.indexOf(twin)
  })

  const current = mapped.filter(
    (m) =>
      m.row.status === 'IN_REVIEW' ||
      m.row.status === 'ACCEPTED' ||
      (m.row.status === 'NOT_ACCEPTED' && m.raw.createdAt.getTime() >= cutoff),
  )
  const hasLive = current.some((m) => m.row.status !== 'NOT_ACCEPTED')
  const newestExpired = hasLive
    ? []
    : mapped
        .filter((m) => m.row.status === 'EXPIRED')
        .sort((a, b) => (b.raw.policyExpiryDate?.getTime() ?? 0) - (a.raw.policyExpiryDate?.getTime() ?? 0))
        .slice(0, 1)

  return [...current, ...newestExpired]
    .sort((a, b) => {
      const byStatus = STATUS_ORDER[a.row.status] - STATUS_ORDER[b.row.status]
      if (byStatus !== 0) return byStatus
      if (a.row.status === 'ACCEPTED') {
        const byExpiry = (b.raw.policyExpiryDate?.getTime() ?? 0) - (a.raw.policyExpiryDate?.getTime() ?? 0)
        if (byExpiry !== 0) return byExpiry
      }
      return b.raw.createdAt.getTime() - a.raw.createdAt.getTime()
    })
    .slice(0, MAX_ROWS)
    .map((m) => m.row)
}

/**
 * The "Insurance on file" figure on the terms block, derived from the
 * certificates rather than `Company.coiOnFile` / `coiExpiry` — a hand-typed
 * cache nothing writes (project memory, 2026-09-09: eleven accounts read
 * "expired" against a live approved cert). Null when no certificate says
 * anything, so the caller falls back to the cached columns: a date typed
 * off a document that was never uploaded is still the only record of it.
 */
export function accountCoiSummary(rows: ClientCoiRow[]): { through: string } | { inReview: true } | null {
  const covering = rows
    .filter((r) => r.coversShows && r.policyExpiry)
    .sort((a, b) => (b.policyExpiry! < a.policyExpiry! ? -1 : 1))[0]
  if (covering) return { through: covering.policyExpiry! }
  if (rows.some((r) => r.status === 'IN_REVIEW' && r.kind === 'COI')) return { inReview: true }
  return null
}

export async function listClientCois(companyId: string, now: Date = new Date()): Promise<ClientCoiRow[]> {
  const rows = await prisma.coiCheck.findMany({
    where: { companyId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: {
      id: true,
      originalFilename: true,
      createdAt: true,
      source: true,
      clientUploaderName: true,
      namedInsured: true,
      policyExpiryDate: true,
      humanDecision: true,
      aiResponse: true,
    },
  })
  return selectClientCois(rows, now)
}

// ── Staff side: /crm/portals ─────────────────────────────────────────────

export interface StaffAccountCoi {
  id: string
  filename: string
  humanDecision: string
  policyExpiry: Date | null
  namedInsured: string | null
  kind: CoiDocumentKind
  jobCode: string | null
  uploadedBy: string | null
  createdAt: Date
  /** Filename of an APPROVED certificate this one is a copy of (same size,
   *  insured and expiry), when it is one. */
  duplicateOf: string | null
}

export interface StaffAccountCoiState {
  /** PENDING / COUNTERED and not lapsed — the ones a human has to decide. */
  awaiting: StaffAccountCoi[]
  /** APPROVED and not lapsed. */
  approved: StaffAccountCoi[]
  /** Latest expiry among approved FULL certificates — what the carry-forward
   *  reads; null when there is none. */
  coveringThrough: Date | null
}

export interface RawStaffAccountCoi extends RawAccountCoi {
  companyId: string | null
  fileSize: number
  jobCode: string | null
  uploaderName: string | null
}

export function groupStaffAccountCois(rows: RawStaffAccountCoi[], now: Date): Map<string, StaffAccountCoiState> {
  const out = new Map<string, StaffAccountCoiState>()
  const toRow = (r: RawStaffAccountCoi): StaffAccountCoi & { fileSize: number } => ({
    id: r.id,
    filename: r.originalFilename,
    humanDecision: String(r.humanDecision),
    policyExpiry: r.policyExpiryDate,
    namedInsured: r.namedInsured,
    kind: coiDocumentKind(r.aiResponse),
    jobCode: r.jobCode,
    uploadedBy: r.source === 'CLIENT_UPLOAD' ? r.clientUploaderName : r.uploaderName,
    createdAt: r.createdAt,
    duplicateOf: null,
    fileSize: r.fileSize,
  })
  for (const r of rows) {
    if (!r.companyId || isExpired(r.policyExpiryDate, now)) continue
    const state = out.get(r.companyId) ?? { awaiting: [], approved: [], coveringThrough: null }
    out.set(r.companyId, state)
    const row = toRow(r)
    if (r.humanDecision === 'APPROVED') {
      state.approved.push(row)
      if (row.kind === 'COI' && r.policyExpiryDate && (!state.coveringThrough || r.policyExpiryDate > state.coveringThrough)) {
        state.coveringThrough = r.policyExpiryDate
      }
    } else if (r.humanDecision === 'PENDING' || r.humanDecision === 'COUNTERED') {
      state.awaiting.push(row)
    }
  }
  for (const state of out.values()) {
    for (const p of state.awaiting as (StaffAccountCoi & { fileSize: number })[]) {
      const twin = (state.approved as (StaffAccountCoi & { fileSize: number })[]).find(
        (a) =>
          a.fileSize === p.fileSize &&
          samePolicy(
            { kind: a.kind, namedInsured: a.namedInsured, policyExpiryDate: a.policyExpiry },
            { kind: p.kind, namedInsured: p.namedInsured, policyExpiryDate: p.policyExpiry },
          ),
      )
      p.duplicateOf = twin?.filename ?? null
    }
    // Two APPROVED copies: the later one names the earlier original.
    const approvedOldestFirst = [...(state.approved as (StaffAccountCoi & { fileSize: number })[])].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )
    approvedOldestFirst.forEach((a, i) => {
      const original = approvedOldestFirst
        .slice(0, i)
        .find(
          (o) =>
            o.fileSize === a.fileSize &&
            samePolicy(
              { kind: o.kind, namedInsured: o.namedInsured, policyExpiryDate: o.policyExpiry },
              { kind: a.kind, namedInsured: a.namedInsured, policyExpiryDate: a.policyExpiry },
            ),
        )
      a.duplicateOf = original?.filename ?? null
    })
    // Strip the working field so nothing downstream renders a byte count.
    state.awaiting = state.awaiting.map(({ fileSize: _f, ...rest }: StaffAccountCoi & { fileSize?: number }) => rest)
    state.approved = state.approved.map(({ fileSize: _f, ...rest }: StaffAccountCoi & { fileSize?: number }) => rest)
  }
  return out
}

/** One query for every company on the Portals tab. */
export async function staffAccountCois(companyIds: string[], now: Date = new Date()): Promise<Map<string, StaffAccountCoiState>> {
  if (companyIds.length === 0) return new Map()
  const rows = await prisma.coiCheck.findMany({
    where: { companyId: { in: companyIds }, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      companyId: true,
      originalFilename: true,
      fileSize: true,
      createdAt: true,
      source: true,
      clientUploaderName: true,
      namedInsured: true,
      policyExpiryDate: true,
      humanDecision: true,
      aiResponse: true,
      job: { select: { jobCode: true } },
      uploadedBy: { select: { name: true } },
    },
  })
  return groupStaffAccountCois(
    rows.map(({ job, uploadedBy, ...r }) => ({ ...r, jobCode: job?.jobCode ?? null, uploaderName: uploadedBy?.name ?? null })),
    now,
  )
}
