import { checkAnthropic } from './anthropic'
import { checkResend } from './resend'
import { checkNeon } from './neon'
import { checkRentalWorks } from './rentalworks'
import { checkDns } from './dns'
import { checkGmailIngestion } from './gmail'
import { rollupOverall, type HealthReport } from './types'

/**
 * Orchestrator: runs every probe in parallel and rolls up an overall
 * status. Each probe is responsible for its own error containment —
 * none should throw past this layer. We still wrap each in a defensive
 * try/catch in case a future probe forgets to do so.
 *
 * Total wall time ≈ slowest probe (currently the Anthropic call at
 * ~1–3s on Haiku).
 */
export async function runAllHealthChecks(): Promise<HealthReport> {
  const timestamp = new Date().toISOString()

  const [anthropic, resend, neon, rentalworks, cloudflare_dns, gmail_ingestion] = await Promise.all([
    safe(checkAnthropic, 'anthropic'),
    safe(checkResend, 'resend'),
    safe(checkNeon, 'neon'),
    safe(checkRentalWorks, 'rentalworks'),
    safe(checkDns, 'cloudflare_dns'),
    safe(checkGmailIngestion, 'gmail_ingestion'),
  ])

  const report: HealthReport = {
    timestamp,
    overall: 'healthy',
    services: { anthropic, resend, neon, rentalworks, cloudflare_dns, gmail_ingestion },
  }
  report.overall = rollupOverall(report)
  return report
}

async function safe<T extends { status: string; lastChecked: string }>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return {
      status: 'down',
      error: `[${label}] probe threw: ${error}`,
      lastChecked: new Date().toISOString(),
    } as unknown as T
  }
}
