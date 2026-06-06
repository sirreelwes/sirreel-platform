import { NextResponse } from "next/server"
import { google } from "googleapis"
import { prisma } from "@/lib/prisma"
import { WATCHED_INBOXES } from "@/lib/email/watchedInboxes"

/**
 * POST/GET /api/gmail/watch — renew the Gmail Pub/Sub watch on every
 * monitored inbox. Vercel cron hits this daily (vercel.json) so a
 * single failed renewal has days of retries before the 7-day Gmail
 * watch TTL burns and ingestion goes dark.
 *
 * Each per-inbox success is stamped onto `EmailAccount.lastWatchedAt`
 * — that's the ground truth the dead-man's-switch health probe
 * reads. Failures are logged loudly to stderr (the prior version
 * caught + collected them silently into the response body, so the
 * cron returned HTTP 200 even when every inbox failed).
 *
 * Response contract: `ok: true` ONLY when every inbox renewed.
 * Any per-inbox failure flips the response to HTTP 502 so the
 * Vercel cron dashboard surfaces it as a failed run instead of a
 * silent green tick.
 */

const TOPIC_NAME = "projects/optical-torch-490915-e3/topics/gmail-notifications"
// WATCHED_INBOXES centralized in src/lib/email/watchedInboxes.ts —
// imported above so this route's renewal loop iterates the same
// list pubsub / sync / fetch use.

interface PerInboxResult {
  email: string
  ok: boolean
  historyId?: string
  error?: string
}

async function renewWatches(): Promise<{ allOk: boolean; results: PerInboxResult[] }> {
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "{}"
  if (rawKey === "{}") throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set")
  const credentials = JSON.parse(rawKey)
  const results: PerInboxResult[] = []
  for (const email of WATCHED_INBOXES) {
    try {
      const authed = new google.auth.JWT(
        credentials.client_email,
        undefined,
        credentials.private_key,
        ["https://www.googleapis.com/auth/gmail.modify"],
        email,
      )
      const gmail = google.gmail({ version: "v1", auth: authed })
      // Subscribe to both INBOX and SENT — without SENT, outbound mail
      // never triggers a notification and EmailThread.lastDirection
      // can't be maintained by the Pub/Sub handler. labelIds is an OR
      // filter on the Gmail Watch API, so notifications fire on
      // changes to EITHER.
      const res = await gmail.users.watch({
        userId: "me",
        requestBody: { topicName: TOPIC_NAME, labelIds: ["INBOX", "SENT"] },
      })
      // Stamp ground truth — the health probe reads this. updateMany
      // (not update) so a missing-row scenario is a per-inbox failure
      // signal instead of throwing the whole loop.
      await prisma.emailAccount.updateMany({
        where: { emailAddress: email },
        data: { lastWatchedAt: new Date() },
      })
      results.push({ email, historyId: res.data.historyId ?? undefined, ok: true })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      // Stderr so it lands in Vercel function logs verbatim. The prior
      // collect-and-return-200 pattern hid identical failures for
      // months — be loud here.
      console.error(`[gmail/watch] renew FAILED for ${email}: ${reason}`)
      results.push({ email, ok: false, error: reason })
    }
  }
  const allOk = results.every((r) => r.ok)
  return { allOk, results }
}

async function handle() {
  try {
    const { allOk, results } = await renewWatches()
    const body = { success: allOk, results, renewedAt: new Date().toISOString() }
    // 502 on partial/total failure so Vercel's cron dashboard logs a
    // failed run. The body still carries the per-inbox detail so curl
    // / on-call can see exactly which inbox lapsed.
    return NextResponse.json(body, { status: allOk ? 200 : 502 })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(`[gmail/watch] renew threw before per-inbox loop: ${reason}`)
    return NextResponse.json({ error: reason }, { status: 500 })
  }
}

export async function POST() {
  return handle()
}

export async function GET() {
  return handle()
}
