/**
 * Minimal Slack Web API helper. One function, no SDK abstraction.
 *
 * Env:
 *   SLACK_BOT_TOKEN     — xoxb-... bot user OAuth token (required to send)
 *   SLACK_ALERT_CHANNEL — channel ID or "#channel-name" (required to send)
 *
 * The bot must be invited to the target channel by a workspace admin
 * before chat.postMessage will succeed (Slack returns "not_in_channel"
 * otherwise — surfaced verbatim in the returned reason).
 *
 * Startup probe: warns loudly if SLACK_BOT_TOKEN is missing at module
 * load. Mirrors the lesson from the May 2026 Anthropic outage — silent
 * misconfiguration is the bug, not the absence of the key.
 */

if (!process.env.SLACK_BOT_TOKEN) {
  console.warn(
    '[slack] SLACK_BOT_TOKEN is not set. chat.postMessage will be a no-op until the env var is populated in Vercel.',
  )
}

export interface SlackPostResult {
  ok: boolean
  ts?: string
  channel?: string
  reason?: string
}

export async function postMessage(
  text: string,
  opts?: { thread_ts?: string; channel?: string },
): Promise<SlackPostResult> {
  const token = process.env.SLACK_BOT_TOKEN
  const channel = opts?.channel || process.env.SLACK_ALERT_CHANNEL
  if (!token) return { ok: false, reason: 'SLACK_BOT_TOKEN not set' }
  if (!channel) return { ok: false, reason: 'SLACK_ALERT_CHANNEL not set' }

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel, text, thread_ts: opts?.thread_ts }),
    })
    const data = (await res.json()) as { ok: boolean; ts?: string; channel?: string; error?: string }
    if (!data.ok) return { ok: false, reason: data.error || `http ${res.status}` }
    return { ok: true, ts: data.ts, channel: data.channel }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
