/**
 * Route gate for VerMar's control plane (/api/vermar/*): a signed-in
 * human on the VerMar operator allowlist. Reads AND writes — a SirReel
 * ADMIN role buys nothing here (Wes 2026-09-05: control of other HQs lies
 * with VerMar Design, not within SirReel).
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-admin'
import { isVerMarOperator } from './operator'

export async function requireVerMarOperator(): Promise<{ user: { id: string; email: string } } | NextResponse> {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!isVerMarOperator(user.email)) return NextResponse.json({ error: 'Not a VerMar Design operator.' }, { status: 403 })
  return { user: { id: user.id, email: user.email } }
}

export function operatorErrorResponse(e: unknown): NextResponse {
  const status = typeof (e as { status?: number })?.status === 'number' ? (e as { status: number }).status : 500
  if (status >= 500) console.error('[vermar workspaces]', e)
  return NextResponse.json({ error: status < 500 && e instanceof Error ? e.message : 'Something went wrong.' }, { status })
}
