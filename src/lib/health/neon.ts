import { prisma } from '@/lib/prisma'
import type { ServiceHealth } from './types'

const DEGRADED_LATENCY_MS = 1000
const TIMEOUT_MS = 5000

/**
 * Neon Postgres health probe. Runs `SELECT 1` against the pooler URL
 * with a 5s timeout. Detects pool exhaustion, transient Neon outages,
 * and the (rare) misconfigured DATABASE_URL case.
 *
 * Status:
 *   healthy  — query returned in < 1s
 *   degraded — query returned but exceeded 1s threshold (Neon cold
 *              start or pool pressure — sustained > 1s is a problem)
 *   down     — query failed or timed out
 */
export async function checkNeon(): Promise<ServiceHealth> {
  const lastChecked = new Date().toISOString()
  const start = Date.now()
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)),
    ])
    const latencyMs = Date.now() - start
    const status = latencyMs > DEGRADED_LATENCY_MS ? 'degraded' : 'healthy'
    return {
      status,
      latencyMs,
      error: status === 'degraded' ? `Latency ${latencyMs}ms exceeds ${DEGRADED_LATENCY_MS}ms threshold` : undefined,
      lastChecked,
    }
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      lastChecked,
    }
  }
}
