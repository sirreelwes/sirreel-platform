import { prisma } from '@/lib/prisma'
import { decryptSecret, encryptSecret, rwTokenKey } from '@/lib/crypto/secretBox'

/**
 * The RentalWorks credential: where the token lives, how it is renewed, and
 * how HQ decides whether the connection is healthy.
 *
 * Status is driven by LIVE VERIFICATION, never by the token's own exp claim
 * (Wes 2026-09-02). RentalWorks is a Database Works "FW" product and issues
 * a cosmetic ~300-second `exp` that it then honors for weeks; the real
 * rotation cadence is ~50 days. A meter keyed to that claim would be red
 * five minutes after every rotation and would teach everyone to ignore it.
 *
 *   green   last verify said OK, and rotated inside 45 days
 *   yellow  last verify said OK, but the token is 45+ days old
 *   red     last verify failed, or nothing has ever verified it
 */

export const RW_PROVIDER = 'RENTALWORKS'
export const ROTATE_AFTER_DAYS = 45

const JWT_URL = 'https://sirreel.rentalworks.cloud/api/v1/jwt'
const PING_URL = 'https://sirreel.rentalworks.cloud/api/v1/item?pageNo=1&pageSize=1'
const TIMEOUT_MS = 20_000

export type RwVerifyStatus = 'OK' | 'EXPIRED' | 'ERROR'
export type RwHealth = 'green' | 'yellow' | 'red'

export interface RwCredentialStatus {
  health: RwHealth
  /** Null when the token has never been rotated through HQ. */
  lastRotatedAt: string | null
  lastVerifiedAt: string | null
  lastVerifyStatus: RwVerifyStatus | null
  /** Informational only — see the note above. Never an input to `health`. */
  jwtExpInformational: string | null
  updatedBy: string | null
  /** When the 45-day proactive rotation is due. */
  rotateDueAt: string | null
  /** True while the env var is still the only source (pre-migration). */
  usingEnvFallback: boolean
}

/** Decode a JWT's `exp` without verifying it — we are recording, not trusting. */
export function jwtExp(token: string): Date | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    )
    const exp = JSON.parse(json)?.exp
    return typeof exp === 'number' ? new Date(exp * 1000) : null
  } catch {
    return null
  }
}

async function row() {
  return prisma.integrationCredential.findUnique({ where: { provider: RW_PROVIDER } })
}

/**
 * The token every RentalWorks call uses.
 *
 * DB first, env var second. The env fallback is a ONE-DEPLOY bridge so the
 * cutover cannot black out RW access; once the meter shows green from a
 * stored credential, RENTALWORKS_TOKEN comes out of Vercel and the fallback
 * with it.
 */
export async function readRwToken(): Promise<string | null> {
  const r = await row()
  if (r?.encryptedToken) {
    // A deployment that has the row but NOT the key would otherwise take
    // every RentalWorks call down. That is a deploy-ordering accident, not a
    // security event, so fall back to the env var and say so loudly.
    if (!process.env.RW_TOKEN_KEY) {
      console.error(
        '[rw] a stored credential exists but RW_TOKEN_KEY is not set in this environment — ' +
          'falling back to RENTALWORKS_TOKEN. Set the key.',
      )
      return process.env.RENTALWORKS_TOKEN?.trim() || null
    }
    try {
      return decryptSecret(r.encryptedToken, rwTokenKey(), 'RW_TOKEN_KEY')
    } catch (err) {
      // Key present but the blob will not open: wrong key or tampering.
      // Never quietly reach for a stale env var here — that is the silent
      // degradation this whole goal exists to remove.
      console.error('[rw] stored token failed to decrypt:', (err as Error).message)
      throw err
    }
  }
  return process.env.RENTALWORKS_TOKEN?.trim() || null
}

export async function writeRwToken(args: {
  token: string
  updatedBy: string
  /** A hand-paste sets this; an automatic rotation passes 'system'. */
  markRotated?: boolean
}): Promise<void> {
  const encryptedToken = encryptSecret(args.token, rwTokenKey(), 'RW_TOKEN_KEY')
  const data = {
    encryptedToken,
    jwtExpInformational: jwtExp(args.token),
    updatedBy: args.updatedBy,
    ...(args.markRotated === false ? {} : { lastRotatedAt: new Date() }),
  }
  await prisma.integrationCredential.upsert({
    where: { provider: RW_PROVIDER },
    create: { provider: RW_PROVIDER, ...data },
    update: data,
  })
}

export async function recordVerify(status: RwVerifyStatus): Promise<void> {
  await prisma.integrationCredential.updateMany({
    where: { provider: RW_PROVIDER },
    data: { lastVerifiedAt: new Date(), lastVerifyStatus: status },
  })
}

export async function rwCredentialStatus(): Promise<RwCredentialStatus> {
  const r = await row()
  const usingEnvFallback = !r?.encryptedToken && !!process.env.RENTALWORKS_TOKEN
  const rotateDueAt = r?.lastRotatedAt
    ? new Date(r.lastRotatedAt.getTime() + ROTATE_AFTER_DAYS * 86400000)
    : null

  let health: RwHealth = 'red'
  if (r?.lastVerifyStatus === 'OK') {
    health = rotateDueAt && rotateDueAt.getTime() <= Date.now() ? 'yellow' : 'green'
  }

  return {
    health,
    lastRotatedAt: r?.lastRotatedAt?.toISOString() ?? null,
    lastVerifiedAt: r?.lastVerifiedAt?.toISOString() ?? null,
    lastVerifyStatus: (r?.lastVerifyStatus as RwVerifyStatus) ?? null,
    jwtExpInformational: r?.jwtExpInformational?.toISOString() ?? null,
    updatedBy: r?.updatedBy ?? null,
    rotateDueAt: rotateDueAt?.toISOString() ?? null,
    usingEnvFallback,
  }
}

/** Is the stored token old enough to renew before anyone notices? */
export async function isRotationDue(): Promise<boolean> {
  const r = await row()
  if (!r?.lastRotatedAt) return false
  return Date.now() - r.lastRotatedAt.getTime() >= ROTATE_AFTER_DAYS * 86400000
}

/**
 * Mint a fresh token from RW_USERNAME / RW_PASSWORD.
 *
 * The trap this guards: FW's /jwt answers **HTTP 200 even for bad
 * credentials**. Success is `access_token` present AND a statuscode that is
 * not an error — never the HTTP status (Wes 2026-09-02).
 */
export async function mintRwToken(): Promise<
  { ok: true; token: string } | { ok: false; reason: string }
> {
  const username = process.env.RW_USERNAME?.trim()
  const password = process.env.RW_PASSWORD?.trim()
  if (!username || !password) {
    return { ok: false, reason: 'RW_USERNAME / RW_PASSWORD are not set' }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(JWT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ UserName: username, Password: password }),
      signal: ctrl.signal,
    })
    const json = (await res.json().catch(() => null)) as {
      access_token?: string | null
      statuscode?: number | string
      statusmessage?: string
    } | null

    if (!json) return { ok: false, reason: `unreadable /jwt response (HTTP ${res.status})` }

    const code = json.statuscode
    const codeIsError =
      code !== undefined && code !== null && String(code) !== '0' && String(code) !== '200'
    if (!json.access_token || codeIsError) {
      return {
        ok: false,
        reason: `RentalWorks rejected the credentials (statuscode ${code ?? '?'}: ${
          json.statusmessage ?? 'no message'
        })`,
      }
    }
    return { ok: true, token: json.access_token }
  } catch (err) {
    return { ok: false, reason: `network: ${(err as Error).message}` }
  } finally {
    clearTimeout(timer)
  }
}

/** Exercise a token against a cheap endpoint. Cheapest read RW offers. */
export async function pingRwToken(token: string): Promise<{ ok: boolean; httpStatus: number }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(PING_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: ctrl.signal,
    })
    return { ok: res.ok, httpStatus: res.status }
  } catch {
    return { ok: false, httpStatus: 0 }
  } finally {
    clearTimeout(timer)
  }
}
