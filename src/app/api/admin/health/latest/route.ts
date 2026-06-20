import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/health/latest
 *
 * Admin-only. Returns the most recent persisted HealthCheckLog row only —
 * does NOT invoke runAllHealthChecks() and does NOT write a new row.
 *
 * Built as a separate route from `/api/admin/health` specifically so
 * the sidebar's ambient health dot (polling every ~60s across however
 * many admin tabs are open) can never accidentally trigger live probes
 * against Anthropic/RW/Resend. The hourly `/api/cron/health-check` cron
 * is the only writer of fresh rows; this endpoint reads what's there.
 *
 * Response shape:
 *   {
 *     overall: 'healthy' | 'degraded' | 'down' | null,
 *     services: { [serviceName]: { status, ...probe-specific-fields } } | {},
 *     checkedAt: ISO 8601 string | null,
 *   }
 *
 * `null` fields mean no probe has ever run (fresh DB) — the dot should
 * render a neutral / unknown indicator in that case. Postgres uses the
 * `checkedAt(sort: Desc)` index defined on the model, so this is a
 * single index seek regardless of log table size.
 */
export async function GET() {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const latest = await prisma.healthCheckLog.findFirst({
    orderBy: { checkedAt: 'desc' },
    select: { overall: true, services: true, checkedAt: true },
  })

  if (!latest) {
    return NextResponse.json({ overall: null, services: {}, checkedAt: null })
  }

  return NextResponse.json({
    overall: latest.overall,
    services: latest.services,
    checkedAt: latest.checkedAt.toISOString(),
  })
}
