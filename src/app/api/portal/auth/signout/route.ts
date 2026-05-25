/**
 * POST /api/portal/auth/signout — clear the sr_person_session cookie
 * and redirect to /portal/auth/sign-in.
 *
 * Doesn't revoke the underlying PersonSession row — that's a
 * separate concern (the row stays valid in case the user signs in
 * again from the same email). To force log-out-everywhere, an admin
 * UI (Phase 4+) can set PersonSession.revokedAt.
 */

import { NextRequest, NextResponse } from 'next/server'
import { buildPersonSessionCookieHeader } from '@/lib/portal/personSession'

export const dynamic = 'force-dynamic'

function signoutResponse(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL('/portal/auth/sign-in', req.nextUrl.origin))
  res.headers.append('Set-Cookie', buildPersonSessionCookieHeader('', { clear: true }))
  return res
}

export async function POST(req: NextRequest) {
  return signoutResponse(req)
}

export async function GET(req: NextRequest) {
  // Allow GET so plain anchor `<a href=…>` works too. The form-post
  // pattern still works via POST below.
  return signoutResponse(req)
}
