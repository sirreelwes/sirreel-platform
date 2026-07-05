/**
 * GET /api/portal/auth/verify?token=...
 *
 * Validates a magic-link token, consumes it, and issues a 30-day
 * person-session cookie. Redirects to /portal/account on success.
 *
 * On any failure (missing/expired/used/revoked token) we redirect
 * back to /portal/auth/sign-in?error=link to keep the surface tight.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  buildPersonSessionCookieHeader,
  createPersonSessionCookieValue,
} from '@/lib/portal/personSession'

export const dynamic = 'force-dynamic'

function redirectTo(req: NextRequest, path: string): NextResponse {
  const url = new URL(path, req.nextUrl.origin)
  return NextResponse.redirect(url)
}

// Internal-path allowlist for the post-verify redirect (`next` param —
// carried through from the request endpoint, e.g. the public order
// form's reorder flow). Anything not a clean same-host path falls back
// to /portal/account.
function safeNextPath(v: string | null): string | null {
  if (!v) return null
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || v.includes('://')) return null
  return v.length <= 200 ? v : null
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim()
  const nextPath = safeNextPath(req.nextUrl.searchParams.get('next'))
  if (!token) return redirectTo(req, '/portal/auth/sign-in?error=link')

  const session = await prisma.personSession.findUnique({
    where: { magicLinkToken: token },
    select: {
      id: true,
      personId: true,
      magicLinkExpiresAt: true,
      magicLinkUsedAt: true,
      revokedAt: true,
    },
  })

  if (!session) return redirectTo(req, '/portal/auth/sign-in?error=link')
  if (session.revokedAt) return redirectTo(req, '/portal/auth/sign-in?error=link')
  if (session.magicLinkUsedAt) return redirectTo(req, '/portal/auth/sign-in?error=link')
  if (session.magicLinkExpiresAt.getTime() < Date.now()) {
    return redirectTo(req, '/portal/auth/sign-in?error=link')
  }

  const now = new Date()
  await prisma.personSession.update({
    where: { id: session.id },
    data: {
      magicLinkUsedAt: now,
      lastAccessedAt: now,
      accessCount: { increment: 1 },
    },
  })

  const cookieValue = createPersonSessionCookieValue(session.id)
  const res = redirectTo(req, nextPath ?? '/portal/account')
  res.headers.append('Set-Cookie', buildPersonSessionCookieHeader(cookieValue))
  return res
}
