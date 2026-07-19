import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-admin'
import { canAccessAssistantConfig } from '@/lib/permissions'

/**
 * API guard for the after-hours Assistant admin surface. Allows ADMIN,
 * AGENT (sales), and MANAGER — see canAccessAssistantConfig. Usage mirrors
 * requireAdmin:
 *   const gate = await requireAssistantAccess();
 *   if (gate instanceof NextResponse) return gate;
 *   const { user } = gate;
 */
export async function requireAssistantAccess() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!canAccessAssistantConfig(user.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return { user }
}
