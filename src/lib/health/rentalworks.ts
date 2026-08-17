import type { RentalWorksHealth } from './types'

const PING_URL = 'https://sirreel.rentalworks.cloud/api/v1/item?pageNo=1&pageSize=1'
/** Raised from 8s: RW answered in 356ms when healthy but blew an 8s budget on
 *  three of five checks on 2026-08-16, so 8s was measuring RW's mood. */
const TIMEOUT_MS = 15000

/**
 * RentalWorks health probe. Sends a cheap authenticated GET and infers token
 * health from the response code.
 *
 * The token IS a JWT, but do NOT decode it to predict expiry. RW stamps a
 * 300-second `exp` and then honours the token for weeks — the claim is not
 * what it enforces. Trusting it is what made the invoice sync refuse to run
 * for 21 days with a perfectly good token (see syncInvoices.ts). The response
 * code is the only signal.
 *
 * RW being slow or 5xx is not our outage (it's the vendor's), so upstream
 * problems are degraded rather than down. `down` is reserved for things
 * someone here can actually fix.
 *
 * Status mapping:
 *   200       → healthy
 *   401 / 403 → down (token expired or revoked — needs rotation)
 *   429       → degraded (rate limited; still working, just throttled)
 *   5xx       → degraded (RW server issues)
 *   timeout / network → degraded, AFTER one retry (RW is slow, not us)
 *   no token  → down (someone must set it)
 *
 * Note for whoever tunes this next: the cron alerts on any NON-HEALTHY
 * result, not just `down` (see /api/cron/health-check). So degraded still
 * pages someone — the retry below is what actually suppresses the noise, and
 * the classification only changes whether the message reads as "our token
 * broke" or "the vendor is slow". If degraded should stop alerting, that is a
 * policy change in the cron affecting all six services, not here.
 */
export async function checkRentalWorks(): Promise<RentalWorksHealth> {
  const token = process.env.RENTALWORKS_TOKEN
  if (!token) {
    return {
      status: 'down',
      error: 'RENTALWORKS_TOKEN is unset',
      lastChecked: new Date().toISOString(),
    }
  }

  // One retry, and only for a timeout or transport error. A single slow
  // response is not a verdict on anything — RW intermittently exceeds any
  // budget we give it and then answers in under half a second. An HTTP
  // response, including 401, is definitive and never retried: hammering the
  // gateway with a token it just rejected is pointless.
  const first = await probe(token)
  if (first.status !== 'degraded' || !first.retryable) return strip(first)
  return strip(await probe(token))
}

type Probe = RentalWorksHealth & { retryable?: boolean }

function strip(p: Probe): RentalWorksHealth {
  const { retryable: _retryable, ...rest } = p
  return rest
}

async function probe(token: string): Promise<Probe> {
  const lastChecked = new Date().toISOString()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  const start = Date.now()
  try {
    const res = await fetch(PING_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: ctrl.signal,
    })
    const latencyMs = Date.now() - start
    const httpStatus = res.status

    if (res.ok) {
      return { status: 'healthy', latencyMs, httpStatus, lastChecked }
    }
    if (httpStatus === 401 || httpStatus === 403) {
      return {
        status: 'down',
        latencyMs,
        httpStatus,
        error: `RentalWorks rejected token (${httpStatus}) — rotation required. See docs/runbooks/rentalworks-token-rotation.md`,
        lastChecked,
      }
    }
    if (httpStatus === 429) {
      return {
        status: 'degraded',
        latencyMs,
        httpStatus,
        error: 'RentalWorks rate-limited the request (429)',
        lastChecked,
      }
    }
    if (httpStatus >= 500) {
      return {
        status: 'degraded',
        latencyMs,
        httpStatus,
        error: `RentalWorks upstream error ${httpStatus} ${res.statusText}`,
        lastChecked,
      }
    }
    return {
      status: 'degraded',
      latencyMs,
      httpStatus,
      error: `Unexpected RentalWorks response ${httpStatus} ${res.statusText}`,
      lastChecked,
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start
    const isAbort = err?.name === 'AbortError'
    // Degraded, not down: we cannot reach RW, which is RW's problem and not
    // something rotating a token or redeploying would fix. Calling it `down`
    // put timeouts in the same bucket as an expired credential, so three
    // nights of vendor slowness read identically to a real outage.
    return {
      status: 'degraded',
      latencyMs,
      error: isAbort
        ? `RentalWorks did not respond within ${TIMEOUT_MS}ms (retried once)`
        : err?.message || String(err),
      lastChecked,
      retryable: true,
    }
  } finally {
    clearTimeout(timer)
  }
}
