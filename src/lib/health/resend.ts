import type { ResendHealth } from './types'

/**
 * Resend health probe. Lists configured sending domains and verifies
 * sirreel.com is in `verified` state. The Resend API call also doubles
 * as an API-key validity check: a 401 means the key is wrong/revoked.
 *
 * Status:
 *   healthy   — sirreel.com is verified
 *   degraded  — sirreel.com is present but in a non-verified state
 *               (pending / temporary_failure / not_started) — outbound
 *               sends will still 4xx, but the key itself is valid
 *   down      — no API key, no sirreel.com entry, or auth fails
 */
export async function checkResend(): Promise<ResendHealth> {
  const lastChecked = new Date().toISOString()
  const key = process.env.RESEND_API_KEY
  if (!key) {
    return { status: 'down', error: 'RESEND_API_KEY is unset', lastChecked }
  }

  const start = Date.now()
  try {
    const res = await fetch('https://api.resend.com/domains', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    })
    const latencyMs = Date.now() - start

    if (res.status === 401 || res.status === 403) {
      return {
        status: 'down',
        latencyMs,
        error: `Resend rejected API key (${res.status})`,
        lastChecked,
      }
    }
    if (!res.ok) {
      return {
        status: 'degraded',
        latencyMs,
        error: `Resend returned ${res.status} ${res.statusText}`,
        lastChecked,
      }
    }

    const body = (await res.json()) as { data?: { name: string; status: string }[] }
    const sirreel = body.data?.find(d => d.name === 'sirreel.com')
    if (!sirreel) {
      return {
        status: 'down',
        latencyMs,
        error: 'sirreel.com is not registered as a Resend sending domain',
        lastChecked,
      }
    }
    if (sirreel.status !== 'verified') {
      return {
        status: 'degraded',
        latencyMs,
        sirreelDomainStatus: sirreel.status,
        error: `sirreel.com domain status is "${sirreel.status}" (expected "verified")`,
        lastChecked,
      }
    }
    return {
      status: 'healthy',
      latencyMs,
      sirreelDomainStatus: sirreel.status,
      lastChecked,
    }
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      lastChecked,
    }
  }
}
