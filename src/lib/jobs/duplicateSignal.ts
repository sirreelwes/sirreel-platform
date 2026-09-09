import { prisma } from '@/lib/prisma'

/**
 * "These two jobs might be the same production."
 *
 * The nightly Planyo importer already makes this call and already records
 * it — resolveJobForBooking emits CREATED_NEW_SIBLING when it builds a job
 * beside a plausible existing one, and ATTACHED_AMBIGUOUS when it attaches
 * on a name hint it is not certain about. Until now that decision went to
 * a 6 AM Slack alert and nowhere else, which is how SR-JOB-0328 "WS-RK"
 * sat beside SR-JOB-0315 "WS" for two days with Jose adding to one and the
 * client's paperwork on the other (2026-09-09).
 *
 * ONE derivation, read by both surfaces — the /jobs action-items panel and
 * the banner on the job page — so the list and the detail can never
 * disagree about whether a job has a twin (the coiState.ts lesson).
 *
 * Nothing is stored: the signal is the sync event that already exists,
 * re-checked against live state on every read. That is what makes it
 * self-clearing — archive either twin (which is what merging does) and the
 * signal is gone on the next read, with no cleanup step to forget.
 */

/** How far back to look. Matches the /jobs dormancy horizon: a pairing
 *  nobody acted on in a month has been accepted in practice, and
 *  resurfacing it forever would train people to ignore the panel. */
const WINDOW_DAYS = 30

const DETAIL_PREFIX = '[CART_JOB_RESOLVED]'

export interface DuplicateJobCandidate {
  jobId: string
  jobCode: string
  name: string
  /** resolveJob's score + the rungs that fired, shown as the "why". */
  score: number | null
  reasons: string[]
}

export interface DuplicateJobSignal {
  /** PlanyoSyncEvent id — stable, so a dismissal sticks to this pairing. */
  eventId: string
  detectedAt: Date
  cart: string | null
  /** 'created_sibling' — a NEW job was built beside the candidates.
   *  'attached_ambiguous' — the booking was attached on a soft anchor. */
  mode: 'created_sibling' | 'attached_ambiguous'
  /** The job the importer landed the Planyo booking on. */
  job: { jobId: string; jobCode: string; name: string; companyName: string | null }
  /** Live, non-archived jobs it might be a duplicate of. Never empty —
   *  a signal whose candidates are all gone is not returned at all. */
  candidates: DuplicateJobCandidate[]
}

interface StoredResolution {
  action?: unknown
  jobId?: unknown
  candidates?: unknown
}

function readResolution(after: unknown): StoredResolution | null {
  if (!after || typeof after !== 'object') return null
  const r = (after as Record<string, unknown>).jobResolution
  if (!r || typeof r !== 'object') return null
  return r as StoredResolution
}

function readCandidateCodes(r: StoredResolution): { jobCode: string; score: number | null; reasons: string[] }[] {
  if (!Array.isArray(r.candidates)) return []
  const out: { jobCode: string; score: number | null; reasons: string[] }[] = []
  for (const c of r.candidates) {
    if (!c || typeof c !== 'object') continue
    const row = c as Record<string, unknown>
    if (typeof row.jobCode !== 'string' || !row.jobCode) continue
    out.push({
      jobCode: row.jobCode,
      score: typeof row.score === 'number' ? row.score : null,
      reasons: Array.isArray(row.reasons) ? row.reasons.filter((x): x is string => typeof x === 'string') : [],
    })
  }
  return out
}

/**
 * Every unresolved "possible duplicate" pairing.
 *
 * @param opts.jobId  Restrict to pairings that involve this job on EITHER
 *                    side — opening either twin has to show the banner,
 *                    or the person who opened the wrong one learns nothing.
 */
export async function listDuplicateJobSignals(opts?: {
  now?: Date
  jobId?: string
}): Promise<DuplicateJobSignal[]> {
  const now = opts?.now ?? new Date()
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)

  const events = await prisma.planyoSyncEvent.findMany({
    where: {
      createdAt: { gte: since },
      detail: { startsWith: DETAIL_PREFIX },
      OR: [
        { detail: { contains: 'CREATED_NEW_SIBLING' } },
        { detail: { contains: 'ATTACHED_AMBIGUOUS' } },
      ],
    },
    select: { id: true, createdAt: true, planyoCartId: true, after: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!events.length) return []

  // Gather every job the events reference, then load them ONCE.
  const subjectIds = new Set<string>()
  const candidateCodes = new Set<string>()
  for (const e of events) {
    const r = readResolution(e.after)
    if (!r) continue
    if (typeof r.jobId === 'string') subjectIds.add(r.jobId)
    for (const c of readCandidateCodes(r)) candidateCodes.add(c.jobCode)
  }
  if (!subjectIds.size) return []

  const jobs = await prisma.job.findMany({
    where: {
      OR: [{ id: { in: Array.from(subjectIds) } }, { jobCode: { in: Array.from(candidateCodes) } }],
    },
    select: {
      id: true,
      jobCode: true,
      name: true,
      archivedAt: true,
      company: { select: { name: true } },
    },
  })
  const byId = new Map(jobs.map((j) => [j.id, j]))
  const byCode = new Map(jobs.map((j) => [j.jobCode, j]))

  const signals: DuplicateJobSignal[] = []
  // One pairing per subject job: a cart resolves once, but a job that
  // somehow collected two events should not produce two identical rows.
  const seenSubjects = new Set<string>()

  for (const e of events) {
    const r = readResolution(e.after)
    if (!r || typeof r.jobId !== 'string') continue
    const subject = byId.get(r.jobId)
    // Archived is the merge signal: merging parks the loser, which
    // retires the pairing without anyone dismissing anything.
    if (!subject || subject.archivedAt) continue
    if (seenSubjects.has(subject.id)) continue

    const candidates: DuplicateJobCandidate[] = []
    for (const c of readCandidateCodes(r)) {
      const j = byCode.get(c.jobCode)
      if (!j || j.archivedAt) continue
      if (j.id === subject.id) continue // the attach target is not its own twin
      candidates.push({ jobId: j.id, jobCode: j.jobCode, name: j.name, score: c.score, reasons: c.reasons })
    }
    if (!candidates.length) continue

    if (opts?.jobId && subject.id !== opts.jobId && !candidates.some((c) => c.jobId === opts.jobId)) continue

    seenSubjects.add(subject.id)
    signals.push({
      eventId: e.id,
      detectedAt: e.createdAt,
      cart: e.planyoCartId,
      mode: r.action === 'ATTACHED_AMBIGUOUS' ? 'attached_ambiguous' : 'created_sibling',
      job: {
        jobId: subject.id,
        jobCode: subject.jobCode,
        name: subject.name,
        companyName: subject.company?.name ?? null,
      },
      candidates,
    })
  }

  return signals
}

/** One-line "why we think so", for the panel row and the banner. */
export function describeDuplicateSignal(s: DuplicateJobSignal): string {
  const others = s.candidates.map((c) => `${c.jobCode} "${c.name}"`).join(', ')
  const why = s.candidates[0]?.reasons[0] ?? 'the Planyo importer was not certain'
  return s.mode === 'created_sibling'
    ? `The nightly Planyo import built this job beside ${others} — ${why.toLowerCase()}. Merge them, or dismiss if they are different shows.`
    : `The Planyo import attached this booking here, but ${others} also matched — ${why.toLowerCase()}. Confirm it landed on the right job.`
}
