import { NextRequest, NextResponse } from "next/server"
import { google } from "googleapis"
import { prisma } from "@/lib/prisma"

const MONITORED = ["info@sirreel.com", "jose@sirreel.com", "oliver@sirreel.com", "ana@sirreel.com", "christian@sirreel.com"]

function getGmailClient(email: string) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "{}"
  const creds = JSON.parse(raw)
  const auth = new google.auth.JWT(
    creds.client_email, undefined, creds.private_key,
    ["https://www.googleapis.com/auth/gmail.readonly"], email
  )
  return google.gmail({ version: "v1", auth })
}

function quickTriage(subject: string, snippet: string): { category: string; priority: number } {
  const text = (subject + " " + snippet).toLowerCase()
  if (text.match(/book|reserv|availab|quote|pricing|rate|how much|need a|looking for|truck|van|cube|cargo|vehicle|rental|coi|insurance|contract|agreement|purchase order/)) return { category: "BOOKING_INQUIRY", priority: 1 }
  if (text.match(/invoice|payment|billing|charge|refund|balance/)) return { category: "BILLING", priority: 2 }
  if (text.match(/complaint|unhappy|damage|accident|broken/)) return { category: "COMPLAINT", priority: 0 }
  if (text.match(/breakdown|repair|maintenance|fleet issue/)) return { category: "FLEET_ISSUE", priority: 0 }
  if (text.match(/follow.?up|checking in|any update|heard back/)) return { category: "SUPPORT", priority: 2 }
  if (text.match(/unsubscribe|no.?reply|newsletter|noreply|notification|automated/)) return { category: "SPAM", priority: 9 }
  return { category: "GENERAL", priority: 3 }
}

async function syncInbox(email: string) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "{}"
  const creds = JSON.parse(raw)
  if (!creds.client_email) return { error: "No key" }

  const systemUser = await prisma.user.findFirst()
  if (!systemUser) return { error: "No users" }

  const gmail = getGmailClient(email)
  const listRes = await gmail.users.messages.list({
    userId: "me", labelIds: ["INBOX"], maxResults: 10, q: "newer_than:1d",
  })

  const messages = listRes.data.messages || []
  let processed = 0

  const account = await prisma.emailAccount.upsert({
    where: { emailAddress: email },
    create: { emailAddress: email, userId: systemUser.id },
    update: {},
  })

  for (const msg of messages) {
    if (!msg.id) continue
    const exists = await prisma.emailMessage.findUnique({ where: { gmailMessageId: msg.id } }).catch(() => null)
    if (exists) continue

    const full = await gmail.users.messages.get({
      userId: "me", id: msg.id, format: "metadata",
      metadataHeaders: ["From", "Subject"],
    })

    const headers = full.data.payload?.headers || []
    const get = (n: string) => headers.find((h: any) => h.name?.toLowerCase() === n.toLowerCase())?.value || ""

    const fromAddress = get("From")
    const subject = get("Subject") || "(no subject)"
    const snippet = full.data.snippet || ""
    const sentAt = new Date(parseInt(full.data.internalDate || "0"))
    const gmailThreadId = full.data.threadId || msg.id
    const labelIds = full.data.labelIds || []

    const emailUser = email.split("@")[0]
    if (fromAddress.toLowerCase().includes(emailUser + "@sirreel.com")) continue
    if (fromAddress.toLowerCase().match(/(jose|oliver|ana|dani|wes|hugo|julian|chris|christian)@sirreel\.com/)) continue

    const { category, priority } = quickTriage(subject, snippet)
    if (priority === 9) continue

    const thread = await prisma.emailThread.upsert({
      where: { gmailThreadId },
      create: { gmailThreadId, subject, lastMessageAt: sentAt, messageCount: 1 },
      update: { lastMessageAt: sentAt, messageCount: { increment: 1 } },
    })

    await prisma.emailMessage.create({
      data: {
        emailAccountId: account.id,
        threadId: thread.id,
        gmailMessageId: msg.id,
        fromAddress,
        toAddresses: [email],
        subject,
        snippet,
        direction: "inbound",
        sentAt,
        isRead: !labelIds.includes("UNREAD"),
        category: category as any,
        status: "TRIAGED" as any,
        priority,
        triageAt: new Date(),
        assignedToId: null,
      },
    }).catch(() => {})

    processed++
  }

  return { processed }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const message = body.message
    if (!message?.data) return NextResponse.json({ ok: true })

    const decoded = Buffer.from(message.data, "base64").toString("utf-8")
    const notification = JSON.parse(decoded)
    const { emailAddress } = notification

    if (!MONITORED.includes(emailAddress)) return NextResponse.json({ ok: true })

    // Sync just the inbox that got notified
    const result = await syncInbox(emailAddress)
    return NextResponse.json({ ok: true, email: emailAddress, ...result })
  } catch (err: any) {
    console.error("[pubsub] error:", err.message)
    return NextResponse.json({ ok: true }) // Always 200 to Pub/Sub
  }
}
