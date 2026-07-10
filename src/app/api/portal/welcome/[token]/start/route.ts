import { NextRequest, NextResponse } from 'next/server'
import { portalBaseUrl } from '@/lib/portal/portalUrl'
import { startWelcomeInvite } from '@/lib/portal/welcomeStart'

export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/welcome/[token]/start — the CLIENT's "Get Paperwork
 * Started" click (plain form POST from /portal/welcome/[token]; public, no
 * session — the 256-bit invite token IS the identity).
 *
 * Thin wrapper: all logic (atomic claim, Job+Order mint, idempotent
 * resolve, paperwork prep, magic-link issue) lives in
 * src/lib/portal/welcomeStart.ts so the verification harness exercises the
 * exact production path. Success → 303 into the job portal (its ?token=
 * handshake sets the client session — no sign-in screen). Anything else →
 * 303 back to the zero-write landing page, which renders the friendly copy.
 */
export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  const result = await startWelcomeInvite(params.token || '')
  if (result.kind === 'redirect') return NextResponse.redirect(result.url, 303)
  return NextResponse.redirect(
    `${portalBaseUrl()}/portal/welcome/${encodeURIComponent(params.token || '')}`,
    303,
  )
}
