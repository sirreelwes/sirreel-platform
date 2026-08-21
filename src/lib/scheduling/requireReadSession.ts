import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'

/**
 * Session gate for scheduling READ routes (availability, hub-summary,
 * stacked-holds, stale-holds, categories, available-units,
 * timeline-native). These feeds carry company names, job names, and
 * schedule shape — before 2026-08 they were reachable with no auth at
 * all on hq.sirreel.com.
 *
 * Reads are gated on "any signed-in staff session" (same bar as
 * reservation-context), NOT on a role: every role that can open the
 * dashboard may see the board. Mutations keep their own stricter
 * per-route permission checks.
 *
 * Usage, first line of the handler:
 *   const denied = await requireReadSession()
 *   if (denied) return denied
 */
export async function requireReadSession(): Promise<NextResponse | null> {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
