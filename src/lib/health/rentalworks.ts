import type { RentalWorksHealth } from './types'

const PING_URL = 'https://sirreel.rentalworks.cloud/api/v1/item?pageNo=1&pageSize=1'
const TIMEOUT_MS = 8000

/**
 * RentalWorks health probe. The RW token is an opaque bearer (not a
 * JWT) so we can't decode an `exp` claim — instead we send a cheap
 * authenticated GET (`/api/v1/item?pageNo=1&pageSize=1`) and infer
 * token health from the response code.
 *
 * RW being slow or 5xx is not our outage (it's the vendor's), so we
 * treat upstream errors as degraded rather than down.
 *
 * Status mapping:
 *   200       → healthy
 *   401 / 403 → down (token expired or revoked — needs rotation)
 *   429       → degraded (rate limited; still working, just throttled)
 *   5xx       → degraded (RW server issues)
 *   timeout / network → down (we can't reach RW at all)
 */
export async function checkRentalWorks(): Promise<RentalWorksHealth> {
  const lastChecked = new Date().toISOString()
  const token = process.env.RENTALWORKS_TOKEN
  if (!token) {
    return { status: 'down', error: 'RENTALWORKS_TOKEN is unset', lastChecked }
  }

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
        error: `RentalWorks rejected token (${httpStatus}) — rotation required`,
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
    return {
      status: 'down',
      latencyMs,
      error: isAbort ? `timeout after ${TIMEOUT_MS}ms` : err?.message || String(err),
      lastChecked,
    }
  } finally {
    clearTimeout(timer)
  }
}
