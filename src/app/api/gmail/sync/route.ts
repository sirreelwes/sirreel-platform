import { NextResponse } from "next/server"
import { google } from "googleapis"
import { prisma } from "@/lib/prisma"

const WATCHED_INBOXES = ["info@sirreel.com", "jose@sirreel.com", "oliver@sirreel.com", "ana@sirreel.com"]

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

export async function POST() {
  try {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "{}"
    const creds = JSON.parse(raw)
    if (!creds.client_email) return NextResponse.json({ error: "No service account key" }, { status: 500 })

    const systemUser = await prisma.user.findFirst()
    if (!systemUser) return NextResponse.json({ error: "No users in DB" }, { status: 500 })

    const results: any[] = []

    for (const email of WATCHED_INBOXES) {
      try {
        const gmail = getGmailClient(email)
        const listRes = await gmail.users.messages.list({
          userId: "me", labelIds: ["INBOX"], maxResults: 20, q: "newer_than:14d",
        })

        const messages = listRes.data.messages || []
        let processed = 0, skipped = 0, errors = 0

        const account = await prisma.emailAccount.upsert({
          where: { emailAddress: email },
          create: { emailAddress: email, userId: systemUser.id },
          update: {},
        })

        for (const msg of messages) {
          if (!msg.id) continue

          const exists = await prisma.emailMessage.findUnique({ where: { gmailMessageId: msg.id } }).catch(() => null)
          if (exists) { skipped++; continue }

          try {
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

            // Skip internal team emails
            const emailUser = email.split("@")[0]
            if (fromAddress.toLowerCase().includes(emailUser + "@sirreel.com")) { skipped++; continue }
            if (fromAddress.toLowerCase().match(/(jose|oliver|ana|dani|wes|hugo|julian|chris|christian)@sirreel\.com/)) { skipped++; continue }

            const { category, priority } = quickTriage(subject, snippet)
            if (priority === 9) { skipped++; continue }

            // Upsert EmailThread using gmailThreadId — get internal UUID back
            const thread = await prisma.emailThread.upsert({
              where: { gmailThreadId },
              create: { gmailThreadId, subject, lastMessageAt: sentAt, messageCount: 1 },
              update: { lastMessageAt: sentAt, messageCount: { increment: 1 } },
            })

            await prisma.emailMessage.create({
              data: {
                emailAccountId: account.id,
                threadId: thread.id,  // internal UUID, not gmailThreadId
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
            })
            processed++
          } catch (e: any) {
            errors++
          }
        }

        results.push({ email, found: messages.length, processed, skipped, errors })
      } catch (err: any) {
        results.push({ email, error: err.message })
      }
    }

    return NextResponse.json({ ok: true, results })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}

export async function GET() { return POST() }
