/**
 * Phase 6.5 — data-scope resolver.
 *
 * Server-side list endpoints (orders, jobs, inquiries, sales/metrics,
 * sales/signals) call resolveDataScope() at the top of their handler
 * to learn:
 *   - userId of the requesting session user (or null when unauthenticated)
 *   - dataScope: 'TEAM' | 'OWN'
 *
 * Endpoints then intersect the user's scope with their query. The
 * exact predicate differs per entity:
 *   - Order: where agentId = userId
 *   - Job:   where agentId = userId
 *   - Inquiry: where assignedToId = userId
 *   - Sales aggregates: pass userId through as the agent filter
 *
 * For unauthenticated requests we return scope='OWN' with userId=null
 * — which the predicate builders translate to "match nothing." Safe
 * default. Routes that genuinely need to be public override this by
 * not calling the helper at all.
 *
 * Privileged roles (ADMIN, MANAGER) always get TEAM regardless of
 * their dataScope column. The column only takes effect for AGENT (and
 * any other peer role we add later).
 */

import { getServerSession } from 'next-auth'
import type { DataScope, UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export interface ResolvedScope {
  userId: string | null
  role: UserRole | null
  scope: DataScope
}

const PRIVILEGED: ReadonlyArray<UserRole> = ['ADMIN', 'MANAGER'] as const

export async function resolveDataScope(): Promise<ResolvedScope> {
  const session = await getServerSession()
  if (!session?.user?.email) {
    // Unauthenticated request — caller decides what to do. Returning
    // OWN with null userId means any subsequent "where agentId = X"
    // predicate evaluates to false → empty result.
    return { userId: null, role: null, scope: 'OWN' }
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, dataScope: true, isActive: true },
  })
  if (!user || !user.isActive) {
    return { userId: null, role: null, scope: 'OWN' }
  }
  // Privileged roles ignore the dataScope column — they always see
  // the whole org's data regardless of how their row is configured.
  if (PRIVILEGED.includes(user.role)) {
    return { userId: user.id, role: user.role, scope: 'TEAM' }
  }
  return { userId: user.id, role: user.role, scope: user.dataScope }
}

/**
 * Builds a Prisma `where` fragment for an Order query that honors
 * the resolved scope. Returns an empty object for TEAM (no extra
 * filter), and `{ agentId: userId }` for OWN. For unauthenticated +
 * OWN with null userId, returns a sentinel that matches no rows.
 */
export function orderScopeWhere(scope: ResolvedScope): Record<string, unknown> {
  if (scope.scope === 'TEAM') return {}
  if (!scope.userId) return { agentId: '__no_user__' }
  return { agentId: scope.userId }
}

/**
 * Same shape for Job — also keyed on agentId.
 */
export function jobScopeWhere(scope: ResolvedScope): Record<string, unknown> {
  if (scope.scope === 'TEAM') return {}
  if (!scope.userId) return { agentId: '__no_user__' }
  return { agentId: scope.userId }
}

/**
 * Inquiry scope — keyed on assignedToId. Unassigned inquiries on the
 * NEW status are intentionally invisible to OWN users (no claim);
 * they only appear once assigned (by Ana, Wes, or another agent
 * during triage).
 */
export function inquiryScopeWhere(scope: ResolvedScope): Record<string, unknown> {
  if (scope.scope === 'TEAM') return {}
  if (!scope.userId) return { assignedToId: '__no_user__' }
  return { assignedToId: scope.userId }
}
