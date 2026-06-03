/**
 * Shared types for the health-monitoring endpoint.
 *
 * Each probe returns a {@link ServiceHealth}. The orchestrator
 * collapses them into a {@link HealthReport} with an `overall` rolled
 * up as: any down → down; any degraded → degraded; else healthy.
 *
 * Adding a new service:
 *   1. Write a probe under src/lib/health/<name>.ts that returns
 *      ServiceHealth (or an extended interface).
 *   2. Wire it into runAllHealthChecks() in ./runAll.ts.
 *   3. Surface it in the admin/health UI tile grid.
 *   4. Add it to the Slack alert body if it should page when down.
 */

export type ServiceStatus = 'healthy' | 'degraded' | 'down'

export interface ServiceHealth {
  status: ServiceStatus
  latencyMs?: number
  error?: string
  lastChecked: string // ISO timestamp
}

export interface AnthropicHealth extends ServiceHealth {
  model?: string
  /** Coarse failure category — distinguishes "empty key" from "rate limited" from "Anthropic down". */
  errorKind?: 'missing_key' | 'invalid_key' | 'rate_limited' | 'upstream' | 'network' | 'unexpected_response'
}

export interface ResendHealth extends ServiceHealth {
  /** verification status of sirreel.com domain reported by Resend */
  sirreelDomainStatus?: string
}

export interface RentalWorksHealth extends ServiceHealth {
  httpStatus?: number
}

export interface DnsHealth extends ServiceHealth {
  hqCname?: string
  sirreelA?: string[]
  hqResolves: boolean
}

export interface GmailIngestionHealth extends ServiceHealth {
  inboxes: {
    emailAddress: string
    lastWatchedAt: string | null
    lastInboundAt: string | null
    status: ServiceStatus
    note: string | null
  }[]
}

export interface HealthReport {
  timestamp: string
  overall: ServiceStatus
  services: {
    anthropic: AnthropicHealth
    resend: ResendHealth
    neon: ServiceHealth
    rentalworks: RentalWorksHealth
    cloudflare_dns: DnsHealth
    gmail_ingestion: GmailIngestionHealth
  }
}

export function rollupOverall(report: Pick<HealthReport, 'services'>): ServiceStatus {
  const statuses = Object.values(report.services).map(s => s.status)
  if (statuses.some(s => s === 'down')) return 'down'
  if (statuses.some(s => s === 'degraded')) return 'degraded'
  return 'healthy'
}
