/**
 * Auto-match an orphan Reservation to a Booking by scoring the
 * Planyo-side identifiers (company, job name, dates) against the
 * native Booking catalogue.
 *
 * Used by the Dispatch linker (Chunk 4) to suggest top candidates
 * for each orphan cart so the rep clicks "Link" instead of typing
 * a search.
 *
 * Scoring (per-Booking, summed):
 *   +50  company exact (case-insensitive, normalized)
 *   +30  company substring (one contains the other, ≥4 chars)
 *   +20  job-name exact
 *   +10  job-name substring
 *
 * Hard gate: the reservation's [startTime, endTime] must overlap
 * the booking's [startDate, endDate]. Bookings outside the date
 * window score 0 and are dropped. A film job that ran in March
 * shouldn't match a Planyo reservation in June even if the company
 * names align — that's a different shoot.
 *
 * Confidence buckets:
 *   HIGH    score >= 60, and the top score is at least 20 points
 *           above the second-best — clear dominant match
 *   MEDIUM  score 30–59 or top is within 20 of second-best
 *   LOW     score 10–29
 *   NONE    no overlap match or score < 10
 *
 * The HIGH/MEDIUM/LOW labels drive whether the UI surfaces a
 * one-click bulk-confirm action (HIGH only) versus a "review and
 * approve" gate (MEDIUM) versus "search needed" (LOW/NONE).
 */

export interface OrphanInput {
  planyoCompany: string | null
  planyoJobName: string | null
  startTime: Date
  endTime: Date
}

export interface BookingCandidate {
  id: string
  bookingNumber: string
  companyName: string | null
  jobName: string | null
  productionName: string | null
  startDate: Date
  endDate: Date
}

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'

export interface MatchResult {
  bookingId: string
  bookingNumber: string
  companyName: string | null
  jobName: string | null
  score: number
  reasons: string[]
}

export interface AutoMatchOutput {
  top: MatchResult | null
  confidence: Confidence
  alternates: MatchResult[] // ranked, excluding top
}

const PUNCTUATION = /[^\p{L}\p{N}\s]/gu

function normalize(s: string | null | undefined): string {
  if (!s) return ''
  return s.toLowerCase().replace(PUNCTUATION, ' ').replace(/\s+/g, ' ').trim()
}

function fuzzyContains(a: string, b: string): boolean {
  // Both strings normalized; require at least 4 chars overlap to count
  // (avoids "LLC" matching every company).
  if (a.length < 4 || b.length < 4) return false
  return a.includes(b) || b.includes(a)
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

export function scoreCandidate(orphan: OrphanInput, candidate: BookingCandidate): MatchResult {
  const reasons: string[] = []
  let score = 0

  // Date overlap is the gate — no points without it.
  if (!overlaps(orphan.startTime, orphan.endTime, candidate.startDate, candidate.endDate)) {
    return {
      bookingId: candidate.id,
      bookingNumber: candidate.bookingNumber,
      companyName: candidate.companyName,
      jobName: candidate.jobName,
      score: 0,
      reasons: ['no date overlap'],
    }
  }
  reasons.push('dates overlap')

  const oCo = normalize(orphan.planyoCompany)
  const cCo = normalize(candidate.companyName)
  if (oCo && cCo) {
    if (oCo === cCo) {
      score += 50
      reasons.push('company exact')
    } else if (fuzzyContains(oCo, cCo)) {
      score += 30
      reasons.push('company substring')
    }
  }

  const oJob = normalize(orphan.planyoJobName)
  const cJob = normalize(candidate.jobName)
  const cProd = normalize(candidate.productionName)
  if (oJob) {
    if (cJob && oJob === cJob) {
      score += 20
      reasons.push('job exact')
    } else if (cProd && oJob === cProd) {
      score += 20
      reasons.push('production exact')
    } else if ((cJob && fuzzyContains(oJob, cJob)) || (cProd && fuzzyContains(oJob, cProd))) {
      score += 10
      reasons.push('job substring')
    }
  }

  return {
    bookingId: candidate.id,
    bookingNumber: candidate.bookingNumber,
    companyName: candidate.companyName,
    jobName: candidate.jobName,
    score,
    reasons,
  }
}

export function autoMatch(orphan: OrphanInput, candidates: BookingCandidate[]): AutoMatchOutput {
  const scored = candidates
    .map((c) => scoreCandidate(orphan, c))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) return { top: null, confidence: 'NONE', alternates: [] }

  const top = scored[0]
  const second = scored[1]
  const gap = second ? top.score - second.score : top.score

  let confidence: Confidence = 'LOW'
  if (top.score >= 60 && gap >= 20) confidence = 'HIGH'
  else if (top.score >= 30) confidence = 'MEDIUM'

  return {
    top,
    confidence,
    alternates: scored.slice(1, 5),
  }
}
