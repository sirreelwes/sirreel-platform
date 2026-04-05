import { NextResponse } from "next/server"
import { google } from "googleapis"

const TOPIC_NAME = "projects/optical-torch-490915-e3/topics/gmail-notifications"
const WATCHED_INBOXES = [
  "info@sirreel.com",
  "jose@sirreel.com", 
  "oliver@sirreel.com",
  "ana@sirreel.com",
]

async function renewWatches() {
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "{}"
  if (rawKey === "{}") throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set")
  const credentials = JSON.parse(rawKey)
  const results = []
  for (const email of WATCHED_INBOXES) {
    try {
      const authed = new google.auth.JWT(
        credentials.client_email,
        undefined,
        credentials.private_key,
        ["https://www.googleapis.com/auth/gmail.modify"],
        email
      )
      const gmail = google.gmail({ version: "v1", auth: authed })
      const res = await gmail.users.watch({
        userId: "me",
        requestBody: { topicName: TOPIC_NAME, labelIds: ["INBOX"] },
      })
      results.push({ email, historyId: res.data.historyId, ok: true })
    } catch (err: any) {
      results.push({ email, error: err.message, ok: false })
    }
  }
  return results
}

export async function POST() {
  try {
    const results = await renewWatches()
    return NextResponse.json({ success: true, results, renewedAt: new Date().toISOString() })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function GET() {
  try {
    const results = await renewWatches()
    return NextResponse.json({ success: true, results, renewedAt: new Date().toISOString() })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
