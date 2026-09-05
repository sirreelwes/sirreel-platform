/**
 * Route gate for the partner's HQ API (/api/public/vendor-hq/[token]).
 * The token is the credential; a closed workspace (cancelled / past due)
 * answers 423 so the UI can say why rather than a bare 404.
 */
import { NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'
import { workspaceByToken, type WsRef, errorStatus } from './actions'

/** A working app writes often — far looser than the 5/10min portal default. */
const HQ_POLICY = { windowMs: 60_000, max: 90 }

export async function gateHq(req: Request, token: string): Promise<{ ws: WsRef } | { error: NextResponse }> {
  if (!checkRateLimit(`vendor-hq:${clientIp(req)}`, HQ_POLICY).ok) {
    return { error: NextResponse.json({ error: 'Slow down.' }, { status: 429 }) }
  }
  const ws = await workspaceByToken(token)
  if (!ws) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (!ws.open) return { error: NextResponse.json({ error: 'This workspace is closed.' }, { status: 423 }) }
  return { ws }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null)
  return b && typeof b === 'object' ? (b as Record<string, unknown>) : {}
}

export function hqErrorResponse(e: unknown): NextResponse {
  const status = errorStatus(e)
  const message = status < 500 && e instanceof Error ? e.message : 'Something went wrong.'
  if (status >= 500) console.error('[vendor-hq]', e)
  return NextResponse.json({ error: message }, { status })
}
