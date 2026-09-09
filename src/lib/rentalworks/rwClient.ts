import { readRwToken, recordVerify, rotateRwToken } from '@/lib/rentalworks/credential'

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
 *
 * ── Exhaust the automatic remedy first (2026-09-09) ────────────────
 *
 * "Fail loud" is about not DISGUISING a dead credential as an empty
 * result. It was never about refusing to fix one we can fix. Until now
 * the only thing in HQ that could mint a token was the once-daily
 * rw-token-check cron, and it only rotated when its OWN ping failed —
 * so a token that died twenty minutes after a passing check left every
 * RW mirror dark for the rest of the day while /jwt would have handed
 * us a working token the whole time. That is exactly what happened on
 * 2026-09-09: the check passed at 13:00 UTC, the token died ~13:30, the
 * order and quote pulls 401'd from 13:50 onward, and nothing would have
 * recovered until 13:00 the following day.
 *
 * So a 401/403 now buys ONE rotation and ONE retry. If the rotation
 * fails, or the retry is rejected too, RwAuthError is raised exactly as
 * before — the credential really is dead and a human has to act.
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

function isAuthFailure(res: Response): boolean {
  return res.status === 401 || res.status === 403
}

/**
 * Stamp the credential red and raise. Reached only once the automatic
 * rotation below has been tried and did not help.
 */
async function raiseAuthFailure(res: Response, path: string): Promise<never> {
  // Best-effort: a failed status write must not mask the auth failure.
  await recordVerify('EXPIRED').catch((err) =>
    console.error('[rwClient] could not record EXPIRED status:', (err as Error).message),
  )
  throw new RwAuthError(path, res.status)
}

/**
 * A failed mint is not worth repeating on every request. When RW is
 * refusing the LOGIN rather than the token — locked account, changed
 * password — every retry is another 20-second round trip on a path that
 * is already burning a sync's time budget, so hold off for a minute.
 */
const ROTATE_COOLDOWN_MS = 60_000
let lastRotationFailedAt = 0

/**
 * One rotation at a time per instance. A sync that has several requests
 * in flight would otherwise fire a mint per request, and each one writes
 * the credential row — last writer wins, and the other requests retry
 * with a token that has already been replaced.
 */
let rotationInFlight: Promise<boolean> | null = null

async function rotateOnce(): Promise<boolean> {
  if (Date.now() - lastRotationFailedAt < ROTATE_COOLDOWN_MS) return false
  if (!rotationInFlight) {
    rotationInFlight = (async () => {
      try {
        const r = await rotateRwToken()
        if (!r.ok) {
          lastRotationFailedAt = Date.now()
          console.error('[rwClient] automatic rotation failed:', r.reason)
          return false
        }
        console.warn('[rwClient] RentalWorks rejected the token — rotated automatically')
        return true
      } catch (err) {
        lastRotationFailedAt = Date.now()
        console.error('[rwClient] automatic rotation threw:', (err as Error).message)
        return false
      } finally {
        rotationInFlight = null
      }
    })()
  }
  return rotationInFlight
}

/**
 * Can this request be sent a second time as-is? A string or byte body
 * can; a stream was consumed by the first attempt, and replaying it
 * would send an empty payload — an answer far more confusing than the
 * 401 we started with. Every caller in HQ passes JSON.stringify(...) or
 * no body at all, so this is a guard, not a limitation.
 */
function isReplayable(body: BodyInit | null | undefined): boolean {
  return (
    body == null ||
    typeof body === 'string' ||
    body instanceof Uint8Array ||
    body instanceof ArrayBuffer
  )
}

export async function rwFetch(path: string, init?: RequestInit): Promise<Response> {
  // authHeader() is resolved per attempt, so the retry below goes out on
  // whatever the rotation stored rather than the token that was rejected.
  const send = async () =>
    fetch(`${RW_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: await authHeader(),
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    })

  const res = await send()
  if (!isAuthFailure(res)) return res
  if (!isReplayable(init?.body)) await raiseAuthFailure(res, path)

  // Nothing reads the rejected response — release it rather than leaving
  // it for the GC on a long-lived instance.
  await res.body?.cancel().catch(() => {})

  if (!(await rotateOnce())) await raiseAuthFailure(res, path)

  const retry = await send()
  if (isAuthFailure(retry)) await raiseAuthFailure(retry, path)
  return retry
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
