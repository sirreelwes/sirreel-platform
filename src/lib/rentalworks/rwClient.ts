import { readRwToken, recordVerify } from '@/lib/rentalworks/credential'

/**
 * The ONE way HQ talks to RentalWorks.
 *
 * Before this, ten call sites each read `process.env.RENTALWORKS_TOKEN` and
 * each decided for itself what a 401 meant: `client.ts` threw a generic
 * Error indistinguishable from any other HTTP failure, the sync jobs folded
 * it into `{ok:false, error}` that a caller could ignore, four API routes
 * fetched RW directly and did their own thing, and the health check was the
 * only place that named it as "rotate the token". An expired credential
 * therefore looked like an empty result set, which is precisely how a
 * silent degradation happens.
 *
 * The rule now (Wes 2026-09-02, "fail loud"): a 401/403 from RentalWorks —
 * or a bad-credential statuscode from /jwt — raises RwAuthError, which
 * nothing catches and turns into another data source. Callers may let it
 * propagate; they may not swallow it.
 */

export const RW_BASE_URL = 'https://sirreel.rentalworks.cloud'

/**
 * The credential is dead. Distinct from every other failure ON PURPOSE, so
 * a `catch` written for flaky networks cannot quietly absorb it.
 */
export class RwAuthError extends Error {
  readonly httpStatus: number
  readonly path: string
  constructor(path: string, httpStatus: number, detail?: string) {
    super(
      `RentalWorks rejected the token (${httpStatus}) on ${path}${detail ? ` — ${detail}` : ''}. ` +
        'The connection is down until it is rotated — see the RentalWorks card on /collections.',
    )
    this.name = 'RwAuthError'
    this.httpStatus = httpStatus
    this.path = path
  }
}

export function isRwAuthError(e: unknown): e is RwAuthError {
  return e instanceof RwAuthError || (e as { name?: string })?.name === 'RwAuthError'
}

/** No credential at all — also fatal, but a different fix than a dead one. */
export class RwNoCredentialError extends Error {
  constructor() {
    super('No RentalWorks token is configured — paste one on the RentalWorks card on /collections.')
    this.name = 'RwNoCredentialError'
  }
}

async function authHeader(): Promise<string> {
  const t = await readRwToken()
  if (!t) throw new RwNoCredentialError()
  return `Bearer ${t}`
}

/**
 * Raise on auth failure, and stamp the credential so the meter turns red
 * the moment anything notices — not only when the nightly check runs.
 */
async function assertNotAuthFailure(res: Response, path: string): Promise<void> {
  if (res.status !== 401 && res.status !== 403) return
  // Best-effort: a failed status write must not mask the auth failure.
  await recordVerify('EXPIRED').catch((err) =>
    console.error('[rwClient] could not record EXPIRED status:', (err as Error).message),
  )
  throw new RwAuthError(path, res.status)
}

export async function rwFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${RW_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: await authHeader(),
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  await assertNotAuthFailure(res, path)
  return res
}

export async function rwGetJson<T>(path: string): Promise<T> {
  const res = await rwFetch(path)
  if (!res.ok) throw new Error(`RW GET ${path} → ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export async function rwPostJson<T>(path: string, body: unknown): Promise<T> {
  const res = await rwFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`RW POST ${path} → ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}
