import Anthropic from '@anthropic-ai/sdk'
import type { AnthropicHealth } from './types'
import { HEALTH_CHECK_MODEL } from '@/lib/ai/models'

const MODEL = HEALTH_CHECK_MODEL
const DEGRADED_LATENCY_MS = 5000

/**
 * Anthropic health probe. Sends a minimal Haiku call ("Reply with
 * exactly: OK") and verifies the response contains "OK". Designed
 * specifically to detect the May 2026 incident: ANTHROPIC_API_KEY
 * silently empty in Vercel Production for 55 days while every
 * AI-powered feature degraded to FALLBACK shape.
 *
 * Cost: ~$0.000003 per call on Haiku (a few input tokens + 1–2 output
 * tokens). At hourly cadence that's ~$0.000072/day — negligible.
 *
 * Failure classification (errorKind):
 *   missing_key       — env var unset or empty string
 *   invalid_key       — 401/403 from Anthropic (bad key)
 *   rate_limited      — 429 (treated as degraded, not down)
 *   upstream          — 5xx from Anthropic
 *   network           — fetch failure / DNS / timeout
 *   unexpected_response — call succeeded but body didn't include "OK"
 */
export async function checkAnthropic(): Promise<AnthropicHealth> {
  const lastChecked = new Date().toISOString()
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || key.trim() === '') {
    return {
      status: 'down',
      error: 'ANTHROPIC_API_KEY is unset or empty',
      errorKind: 'missing_key',
      lastChecked,
    }
  }

  const client = new Anthropic({ apiKey: key })
  const start = Date.now()
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    })
    const latencyMs = Date.now() - start
    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim()

    if (!text.toUpperCase().includes('OK')) {
      return {
        status: 'down',
        latencyMs,
        model: MODEL,
        error: `Unexpected response body: ${JSON.stringify(text).slice(0, 120)}`,
        errorKind: 'unexpected_response',
        lastChecked,
      }
    }

    const status = latencyMs > DEGRADED_LATENCY_MS ? 'degraded' : 'healthy'
    return {
      status,
      latencyMs,
      model: MODEL,
      error: status === 'degraded' ? `Latency ${latencyMs}ms exceeds ${DEGRADED_LATENCY_MS}ms threshold` : undefined,
      lastChecked,
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start
    const httpStatus = err?.status as number | undefined
    let errorKind: AnthropicHealth['errorKind'] = 'network'
    let status: AnthropicHealth['status'] = 'down'
    if (httpStatus === 401 || httpStatus === 403) {
      errorKind = 'invalid_key'
    } else if (httpStatus === 429) {
      errorKind = 'rate_limited'
      status = 'degraded'
    } else if (typeof httpStatus === 'number' && httpStatus >= 500) {
      errorKind = 'upstream'
      status = 'degraded'
    }
    return {
      status,
      latencyMs,
      model: MODEL,
      error: err?.message || String(err),
      errorKind,
      lastChecked,
    }
  }
}
