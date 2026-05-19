import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
import { runAllHealthChecks } from '@/lib/health/runAll'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/health
 *
 * Admin-only. Runs the live probe set and returns a HealthReport. Also
 * persists the result to `sr_health_check_logs` so the /admin/health
 * page can render a 24h history.
 *
 * Query params:
 *   ?history=24  → instead of running a probe, return the last 24h of
 *                  stored check rows for the UI (no fresh probe).
 *
 * This endpoint is the canonical source of truth for service health.
 * The hourly cron at /api/cron/health-check internally invokes
 * runAllHealthChecks() (not this endpoint) so it doesn't need session
 * auth — but the persistence and rollup behavior is identical.
 */
export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const url = new URL(req.url)
  const historyHours = url.searchParams.get('history')
  if (historyHours) {
    const hours = Math.min(Math.max(parseInt(historyHours, 10) || 24, 1), 168)
    const since = new Date(Date.now() - hours * 60 * 60 * 1000)
    const rows = await prisma.healthCheckLog.findMany({
      where: { checkedAt: { gte: since } },
      orderBy: { checkedAt: 'desc' },
      take: 200,
    })
    return NextResponse.json({ history: rows })
  }

  const report = await runAllHealthChecks()
  await prisma.healthCheckLog.create({
    data: {
      overall: report.overall,
      services: report.services as object,
    },
  })
  return NextResponse.json(report)
}
