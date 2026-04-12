import { NextRequest, NextResponse } from "next/server"
import { google } from "googleapis"
import { prisma } from "@/lib/prisma"
import { EmailCategory, EmailStatus } from "@prisma/client"

const WATCHED_INBOXES = ["info@sirreel.com", "jose@sirreel.com", "oliver@sirreel.com", "ana@sirreel.com"]

function getGmailClient(email: string) {
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "{}"
  const credentials = JSON.parse(rawKey)
  const auth = new google.auth.JWT(
    credentials.client_email,
    undefined,
    credentials.private_key,
    ["https://www.googleapis.com/auth/gmail.readonly"],
    email
  )
  return google.gmail({ version: "v1", auth })
}

function triageEmail(subject: string, snippet: string): { category: EmailCategory; priority: number } {
  const text = `${subject} ${snippet}`.toLowerCase()
  if (text.match(/book|reserv|rental request|quote|availab/)) return { category: EmailCategory.BOOKING_INQUIRY, priority: 1 }
  if (text.match(/rent|vehicle|fleet|car|suv|van/)) return { category: EmailCategory.RENTAL_REQUEST, priority: 1 }
  if (text.match(/invoice|payment|billing|charge|refund/)) return { category: EmailCategory.BILLING, priority: 2 }
  if (text.match(/complaint|unhappy|issue|problem|terrible|worst/)) return { category: EmailCategory.COMPLAINT, priority: 0 }
  if (text.match(/breakdown|repair|maintenance|flat tire|accident/)) return { category: EmailCategory.FLEET_ISSUE, priority: 0 }
  if (text.match(/help|support|question|how do/)) return { category: EmailCategory.SUPPORT, priority: 3 }
  if (text.match(/unsubscribe|no-reply|noreply|newsletter/)) return { category: EmailCategory.SPAM, priority: 9 }
  return { category: EmailCategory.GENERAL, priority: 5 }
}

export async function POST(req: NextRequest) {
  try {
    const { email, historyId } = await req.json()
    if (!email || !historyId) return NextResponse.json({ ok: false, error: "Missing email or historyId" }, { status: 400 })
    if (!WATCHED_INBOXES.includes(email)) return NextResponse.json({ ok: false, error: "Email not monitored" }, { status: 403 })

    const account = await prisma.emailAccount.findUnique({ where: { emailAddress: email } })
    if (!account) return NextResponse.json({ ok: false, error: "EmailAccount not found" }, { status: 404 })

    const gmail = getGmailClient(email)
    const historyRes = await gmail.users.history.list({
      userId: "me",
      startHistoryId: String(Number(historyId) - 1),
      historyTypes: ["messageAdded"],
    })

    const historyItems = historyRes.data.history || []
    const processed: string[] = []
    const skipped: string[] = []

    for (const item of historyItems) {
      for (const msg of item.messagesAdded || []) {
        const msgId = msg.message?.id
        if (!msgId) continue

        const exists = await prisma.emailMessage.findUnique({ where: { gmailMessageId: msgId } })
        if (exists) { skipped.push(msgId); continue }

        const full = await gmail.users.messages.get({
          userId: "me",
          id: msgId,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date"],
        })

        const headers = full.data.payload?.headers || []
        const get = (name: string) => headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || ""

        const fromAddress = get("From")
        const toAddresses = get("To").split(",").map((s: string) => s.trim())
        const subject = get("Subject") || "(no subject)"
        const snippet = full.data.snippet || ""
        const sentAt = new Date(parseInt(full.data.internalDate || "0"))
        const threadId = full.data.threadId || ""
        const labelIds = full.data.labelIds || []
        const direction = fromAddress.includes(email) ? "outbound" : "inbound"
        const { category, priority } = triageEmail(subject, snippet)

        await prisma.emailThread.upsert({
          where: { gmailThreadId: threadId },
          create: { gmailThreadId: threadId, subject, lastMessageAt: sentAt, messageCount: 1 },
          update: { lastMessageAt: sentAt, messageCount: { increment: 1 } },
        })

        await prisma.emailMessage.create({
          data: {
            emailAccountId: account.id,
            threadId,
            gmailMessageId: msgId,
            fromAddress,
            toAddresses,
            subject,
            snippet,
            direction,
            sentAt,
            isRead: !labelIds.includes("UNREAD"),
            category,
            status: EmailStatus.TRIAGED,
            priority,
            triageAt: new Date(),
          },
        })
        processed.push(msgId)
      }
    }

    await prisma.emailAccount.update({ where: { id: account.id }, data: { lastSyncAt: new Date() } })
    return NextResponse.json({ ok: true, processed: processed.length, skipped: skipped.length })
  } catch (err: any) {
    console.error("[gmail/fetch] error:", err)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
