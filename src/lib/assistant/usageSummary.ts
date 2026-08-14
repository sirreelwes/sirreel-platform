/**
 * What the after-hours Assistant is actually being used for.
 *
 * The page already listed the last 30 access events. A list answers "what
 * happened" one row at a time; it does not answer "is this working", and the
 * answer to that turned out to be no. Of the first seven access attempts,
 * five were denied — including three in four minutes at 12:25am on
 * 2026-08-14, by someone who knew a vehicle's VIN last-4 but could not
 * produce a job code, and who then stopped trying.
 *
 * So this summarises by OUTCOME and by WHY, not by volume.
 *
 * Two modelling decisions worth stating, because they change the numbers:
 *
 * 1. Attempts are grouped into VISITS. Three denials in four minutes is one
 *    person failing three times, not three uses. Counting them as three
 *    overstates traffic and hides that a single person never got in.
 *
 * 2. Time-of-day is Pacific, not UTC. This is a tool for people standing at
 *    a gate in Sun Valley; 07:25 UTC is 12:25am to them, and "after hours"
 *    is the entire point of the product.
 */

export const VISIT_GAP_MINUTES = 15

export type AssistantAction =
  | 'public.access_released'
  | 'public.access_denied'
  | 'public.emergency_escalation'

export interface AssistantEvent {
  action: string
  createdAt: Date
  ipAddress?: string | null
  newValues?: unknown
}

export interface AssistantVisit {
  startedAt: string
  endedAt: string
  attempts: number
  /** released — they got in. denied — every attempt failed and they stopped. */
  outcome: 'released' | 'denied' | 'escalated'
  reasons: string[]
  vehicle: string | null
  jobName: string | null
}

export interface AssistantUsage {
  totals: {
    attempts: number
    released: number
    denied: number
    escalations: number
    /** Share of VISITS that ended without access — the number that matters. */
    lockoutRate: number | null
  }
  last30Days: { attempts: number; released: number; denied: number }
  /** Denial reason → count, most common first. */
  denialReasons: { reason: string; label: string; count: number }[]
  /** How often each identity factor was the one that failed. */
  factorFailures: { factor: string; failed: number; checked: number }[]
  visits: AssistantVisit[]
  /** Pacific hour (0–23) → attempts. */
  byHour: number[]
  firstUsedAt: string | null
  lastUsedAt: string | null
}

const REASON_LABELS: Record<string, string> = {
  insufficient_factors: 'Could not confirm identity',
  no_resolvable_job_or_vehicle: 'Job or vehicle not recognised',
  no_active_rental: 'No active rental on that job',
  expired_code: 'Access code expired',
}

function val(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function pacificHour(d: Date): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  }).format(d)
  const n = parseInt(h, 10)
  return Number.isFinite(n) ? n % 24 : 0
}

export function summarizeAssistantUsage(events: AssistantEvent[]): AssistantUsage {
  // Oldest first so visit grouping reads forward in time.
  const rows = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  const byHour = new Array(24).fill(0) as number[]
  const reasonCounts = new Map<string, number>()
  const factors: Record<string, { failed: number; checked: number }> = {
    'Job code': { failed: 0, checked: 0 },
    'VIN last-4': { failed: 0, checked: 0 },
    'Name': { failed: 0, checked: 0 },
  }

  let released = 0
  let denied = 0
  let escalations = 0
  const thirtyDaysAgo = Date.now() - 30 * 86_400_000
  const last30 = { attempts: 0, released: 0, denied: 0 }

  const visits: AssistantVisit[] = []
  let current: {
    start: Date
    end: Date
    attempts: number
    outcome: AssistantVisit['outcome']
    reasons: Set<string>
    vehicle: string | null
    jobName: string | null
  } | null = null

  for (const e of rows) {
    const v = val(e.newValues)
    byHour[pacificHour(e.createdAt)] += 1

    const isRelease = e.action === 'public.access_released'
    const isEscalation = e.action === 'public.emergency_escalation'
    if (isRelease) released += 1
    else if (isEscalation) escalations += 1
    else denied += 1

    if (e.createdAt.getTime() >= thirtyDaysAgo) {
      last30.attempts += 1
      if (isRelease) last30.released += 1
      else if (!isEscalation) last30.denied += 1
    }

    if (!isRelease && !isEscalation) {
      const reason = typeof v.reason === 'string' ? v.reason : 'unspecified'
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1)
      // Only counted when the check was actually reported — an absent key
      // means that factor was never reached, not that it passed.
      const checks: [string, unknown][] = [
        ['Job code', v.jobCodeOk],
        ['VIN last-4', v.vinLast4Ok],
        ['Name', v.nameOk],
      ]
      for (const [name, ok] of checks) {
        if (typeof ok === 'boolean') {
          factors[name].checked += 1
          if (!ok) factors[name].failed += 1
        }
      }
    }

    const gapMs = current ? e.createdAt.getTime() - current.end.getTime() : Infinity
    if (!current || gapMs > VISIT_GAP_MINUTES * 60_000) {
      if (current) {
        visits.push({
          startedAt: current.start.toISOString(),
          endedAt: current.end.toISOString(),
          attempts: current.attempts,
          outcome: current.outcome,
          reasons: [...current.reasons],
          vehicle: current.vehicle,
          jobName: current.jobName,
        })
      }
      current = {
        start: e.createdAt,
        end: e.createdAt,
        attempts: 0,
        outcome: 'denied',
        reasons: new Set(),
        vehicle: null,
        jobName: null,
      }
    }
    current.end = e.createdAt
    current.attempts += 1
    // A visit is a success if ANY attempt released — people commonly mistype
    // once before getting in, and that is not a lockout.
    if (isRelease) current.outcome = 'released'
    else if (isEscalation && current.outcome !== 'released') current.outcome = 'escalated'
    else if (typeof v.reason === 'string') current.reasons.add(v.reason)
    if (typeof v.vehicle === 'string') current.vehicle = v.vehicle
    if (typeof v.jobName === 'string') current.jobName = v.jobName
  }
  if (current) {
    visits.push({
      startedAt: current.start.toISOString(),
      endedAt: current.end.toISOString(),
      attempts: current.attempts,
      outcome: current.outcome,
      reasons: [...current.reasons],
      vehicle: current.vehicle,
      jobName: current.jobName,
    })
  }

  const lockedOut = visits.filter((v) => v.outcome === 'denied').length

  return {
    totals: {
      attempts: rows.length,
      released,
      denied,
      escalations,
      lockoutRate: visits.length > 0 ? lockedOut / visits.length : null,
    },
    last30Days: last30,
    denialReasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, label: REASON_LABELS[reason] || reason, count }))
      .sort((a, b) => b.count - a.count),
    factorFailures: Object.entries(factors)
      .map(([factor, f]) => ({ factor, ...f }))
      .filter((f) => f.checked > 0)
      .sort((a, b) => b.failed - a.failed),
    visits: visits.reverse(),
    byHour,
    firstUsedAt: rows[0]?.createdAt.toISOString() ?? null,
    lastUsedAt: rows[rows.length - 1]?.createdAt.toISOString() ?? null,
  }
}
