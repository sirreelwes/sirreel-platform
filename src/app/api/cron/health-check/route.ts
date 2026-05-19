import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runAllHealthChecks } from '@/lib/health/runAll'
import { postMessage as slackPost } from '@/lib/slack'
import type { HealthReport, ServiceHealth } from '@/lib/health/types'

export const dynamic = 'force-dynamic'

const SUPPRESSION_WINDOW_MS = 4 * 60 * 60 * 1000 // 4 hours
const ADMIN_HEALTH_URL = 'https://hq.sirreel.com/admin/health'

/**
 * GET /api/cron/health-check
 *
 * Vercel Cron — fires hourly per vercel.json. Runs the probe set,
 * persists the result, and posts to Slack if anything is non-healthy
 * and we haven't already alerted within the last 4 hours.
 *
 * Auth: same `CRON_SECRET` pattern as the other crons. Open in dev
 * (when CRON_SECRET is unset) so it can be hit manually from curl.
 *
 * Alert suppression contract:
 *   - First non-healthy result in a 4h window → alert + record
 *     alertedAt timestamp.
 *   - Subsequent non-healthy results within 4h → recorded, but no
 *     Slack post (avoids channel spam while a known outage drags on).
 *   - After 4h elapse, if still non-healthy, the next tick re-alerts.
 *   - Healthy results never alert (recovery is silent for now — re-add
 *     a "RECOVERED" post here if oncall starts asking for it).
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const report = await runAllHealthChecks()

  let alerted = false
  let alertResult: { ok: boolean; reason?: string } | null = null
  let alertDetail: string | null = null

  if (report.overall !== 'healthy') {
    const recentAlert = await prisma.healthCheckLog.findFirst({
      where: {
        alertedAt: { not: null, gte: new Date(Date.now() - SUPPRESSION_WINDOW_MS) },
      },
      orderBy: { checkedAt: 'desc' },
    })

    if (!recentAlert) {
      alertDetail = buildAlertSummary(report)
      alertResult = await slackPost(formatSlackMessage(report, alertDetail))
      alerted = alertResult.ok
    }
  }

  await prisma.healthCheckLog.create({
    data: {
      overall: report.overall,
      services: report.services as object,
      alertedAt: alerted ? new Date() : null,
      alertDetail: alerted ? alertDetail : null,
    },
  })

  return NextResponse.json({
    ok: true,
    overall: report.overall,
    alerted,
    alertResult,
    suppressed: report.overall !== 'healthy' && !alerted && alertResult === null,
  })
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

function buildAlertSummary(report: HealthReport): string {
  const lines: string[] = []
  for (const [name, svc] of Object.entries(report.services)) {
    const s = svc as ServiceHealth
    if (s.status === 'healthy') continue
    lines.push(`${name}: ${s.status}${s.error ? ` — ${s.error}` : ''}`)
  }
  return lines.join('\n')
}

function formatSlackMessage(report: HealthReport, detail: string): string {
  const emoji = report.overall === 'down' ? ':rotating_light:' : ':warning:'
  return [
    `${emoji} *SirReel HQ health: ${report.overall.toUpperCase()}*`,
    '',
    detail,
    '',
    `<${ADMIN_HEALTH_URL}|View admin health dashboard>`,
  ].join('\n')
}
