import { NextResponse } from "next/server"
import { google } from "googleapis"

const TOPIC_NAME = "projects/optical-torch-490915-e3/topics/gmail-notifications"
const WATCHED_INBOXES = ["info@sirreel.com", "jose@sirreel.com", "oliver@sirreel.com", "ana@sirreel.com"]

export async function POST() {
  try {
    const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "{}"
    if (rawKey === "{}") {
      return NextResponse.json({ error: "GOOGLE_SERVICE_ACCOUNT_KEY is not set" }, { status: 500 })
    }
    const credentials = JSON.parse(rawKey)
    if (!credentials.client_email || !credentials.private_key) {
      return NextResponse.json({ error: "Missing client_email or private_key", keys: Object.keys(credentials) }, { status: 500 })
    }
    const results = []
    for (const email of WATCHED_INBOXES) {
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
      results.push({ email, historyId: res.data.historyId })
    }
    return NextResponse.json({ success: true, results })
  } catch (err: any) {
    return NextResponse.json({ error: err.message, stack: err.stack?.split("\n").slice(0,5) }, { status: 500 })
  }
}
