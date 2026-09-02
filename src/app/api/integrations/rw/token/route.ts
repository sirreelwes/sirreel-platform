import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'
import {
  RW_PROVIDER,
  pingRwToken,
  readRwToken,
  recordVerify,
  rwCredentialStatus,
  writeRwToken,
} from '@/lib/rentalworks/credential'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/integrations/rw/token — ADMIN only.
 *
 *   { action: 'verify' }            exercise the stored token, record the result
 *   { action: 'paste', token: '…' } replace the token by hand
 *
 * The manual paste is the BACKUP path: the nightly check rotates through
 * /jwt on its own, and this is what you use when that cannot (credentials
 * changed, RW locked the account, an outage during rotation).
 *
 * The token is never echoed back, never logged, and never written into the
 * audit row — the audit records THAT it changed, by whom, and what the
 * verify said. Anyone who can read audit rows must not thereby be able to
 * read a live RW credential.
 */

async function audit(userId: string, action: string, newValues: object) {
  await prisma.auditLog
    .create({
      data: {
        userId,
        action,
        entityType: 'integration_credential',
        entityId: RW_PROVIDER,
        newValues: newValues as never,
      },
    })
    .catch((err) => console.error('[rw/token] audit write failed:', (err as Error).message))
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate
  const { user } = gate

  const body = (await req.json().catch(() => ({}))) as { action?: unknown; token?: unknown }
  const action = typeof body.action === 'string' ? body.action : ''

  if (action === 'paste') {
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 })
    if (token.split('.').length !== 3) {
      return NextResponse.json(
        { error: 'that does not look like a JWT (expected three dot-separated parts)' },
        { status: 400 },
      )
    }

    // Prove it works BEFORE storing it. Storing an unverified paste is how a
    // green meter ends up sitting on a dead credential.
    const ping = await pingRwToken(token)
    if (!ping.ok) {
      await audit(user.id, 'rw_token.paste_rejected', { httpStatus: ping.httpStatus })
      return NextResponse.json(
        {
          error:
            ping.httpStatus === 0
              ? 'Could not reach RentalWorks to check that token — nothing was saved.'
              : `RentalWorks rejected that token (HTTP ${ping.httpStatus}) — nothing was saved.`,
        },
        { status: 400 },
      )
    }

    await writeRwToken({ token, updatedBy: user.id })
    await recordVerify('OK')
    await audit(user.id, 'rw_token.pasted', { verified: true })
    return NextResponse.json({ ok: true, ...(await rwCredentialStatus()) })
  }

  if (action === 'verify') {
    const token = await readRwToken()
    if (!token) {
      await recordVerify('ERROR')
      return NextResponse.json(
        { ok: false, error: 'No token is stored yet.', ...(await rwCredentialStatus()) },
        { status: 200 },
      )
    }
    const ping = await pingRwToken(token)
    const status = ping.ok ? 'OK' : ping.httpStatus === 401 || ping.httpStatus === 403 ? 'EXPIRED' : 'ERROR'

    // First verify after the cutover: the token is still coming from the env
    // var and there is no row to record against, so recordVerify would update
    // nothing and a working connection would keep reading red. If it works,
    // adopt it into the store — that IS the migration, and doing it here
    // means nobody has to paste a token they already have.
    const before = await rwCredentialStatus()
    let adopted = false
    if (ping.ok && before.usingEnvFallback) {
      await writeRwToken({ token, updatedBy: user.id })
      adopted = true
    }

    await recordVerify(status)
    await audit(user.id, 'rw_token.verified', {
      result: status,
      httpStatus: ping.httpStatus,
      adoptedFromEnv: adopted,
    })
    return NextResponse.json({
      ok: ping.ok,
      httpStatus: ping.httpStatus,
      adopted,
      ...(await rwCredentialStatus()),
    })
  }

  return NextResponse.json({ error: "action must be 'paste' or 'verify'" }, { status: 400 })
}
