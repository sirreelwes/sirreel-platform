/**
 * Job ↔ RentalWorks order matching — the ONE scoring implementation.
 *
 * Used by the per-job candidate list (/api/jobs/[id]/rw-orders) and the
 * cross-job suggestions queue (/api/rentalworks/reconcile/suggestions), so
 * both surfaces rank identically and a "suggested" badge always agrees
 * with what the job's own panel shows.
 *
 * Evidence, in order of strength:
 *   - RW `Deal` is the production name → lines up with Job.name
 *   - RW `Agent` → lines up with the HQ job's agent
 *   - RW billing window → the true rental dates
 * Deal/agent matching works even when the job has no dates (common).
 */

export interface JobFacts {
  name: string
  agentName: string | null | undefined
  startDate: Date | string | null | undefined
}

export interface OrderFacts {
  dealName: string | null | undefined
  agent: string | null | undefined
  billingStartDate: Date | string | null | undefined
  firstInvoiceDate: Date | string | null | undefined
}

export interface MatchResult {
  score: number
  reasons: string[]
  distanceDays: number | null
}

/** lowercase, strip punctuation, collapse whitespace */
export function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** "Carlson, Oliver" -> "oliver carlson" */
export function normAgent(s: string | null | undefined): string {
  const raw = (s ?? '').trim()
  if (!raw) return ''
  return norm(raw.includes(',') ? raw.split(',').reverse().join(' ') : raw)
}

export function tokens(s: string | null | undefined): string[] {
  return norm(s).split(' ').filter((t) => t.length > 2)
}

export function scoreOrderMatch(job: JobFacts, order: OrderFacts): MatchResult {
  const jobName = norm(job.name)
  const jobTokens = tokens(job.name)
  const jobAgent = normAgent(job.agentName)
  const jobStart = job.startDate ? new Date(job.startDate).getTime() : null

  let score = 0
  const reasons: string[] = []

  const dealN = norm(order.dealName)
  if (dealN && jobName) {
    if (dealN === jobName) { score += 100; reasons.push('deal name matches job') }
    else if (dealN.includes(jobName) || jobName.includes(dealN)) { score += 60; reasons.push('deal name overlaps job') }
    else {
      const dt = tokens(order.dealName)
      const shared = jobTokens.filter((t) => dt.includes(t))
      if (shared.length) { score += 30; reasons.push(`shares “${shared[0]}”`) }
    }
  }

  if (jobAgent && normAgent(order.agent) === jobAgent) { score += 40; reasons.push('same agent') }

  const anchorDate = order.billingStartDate ?? order.firstInvoiceDate
  let distanceDays: number | null = null
  if (jobStart != null && anchorDate) {
    distanceDays = Math.round(Math.abs(new Date(anchorDate).getTime() - jobStart) / 86_400_000)
    if (distanceDays <= 3) { score += 50; reasons.push('dates line up') }
    else if (distanceDays <= 14) { score += 25; reasons.push('dates close') }
    else if (distanceDays > 120) { score -= 20 }
  }

  return { score, reasons, distanceDays }
}

/**
 * A match strong enough to surface in the one-click suggestions queue.
 * Requires a high score AND either a deal-name signal or a tight date fit —
 * "same agent + vaguely recent" alone is not enough to suggest, because an
 * agent often runs several jobs for one client in the same stretch.
 */
export function isSuggestable(m: MatchResult): boolean {
  const hasNameSignal = m.reasons.some((r) => r.startsWith('deal name'))
  return m.score >= 90 && (hasNameSignal || (m.distanceDays != null && m.distanceDays <= 3))
}
