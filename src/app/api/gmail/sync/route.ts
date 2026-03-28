import { NextResponse } from "next/server"
import { google } from "googleapis"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

async function generateThreadSummary(
  subject: string,
  snippet: string,
  fromAddress: string,
  previousSummary: string | null
): Promise<string> {
  try {
    const prompt = previousSummary
      ? `You are summarizing an email thread for a production vehicle rental company (SirReel).

Previous thread summary: "${previousSummary}"

New message received:
From: ${fromAddress}
Subject: ${subject}
Preview: ${snippet}

Write ONE sentence (max 15 words) updating the thread status. Focus on what's happening and what action is needed, if any. Examples:
- "Donovan confirmed the Cloaked quote at $2,000 — waiting on COI and paperwork"
- "Chelsea completed the rental agreement — all paperwork received for Beyond Studios"
- "Emma requesting hold on 3 cube trucks and 1 VTR van for April 3-4"
- "Blaine sent Workers Comp COI from Wrapbook — Oliver to confirm receipt"

Just the sentence, no quotes.`
      : `You are summarizing an email for a production vehicle rental company (SirReel).

From: ${fromAddress}
Subject: ${subject}
Preview: ${snippet}

Write ONE sentence (max 15 words) describing what this email is about. Focus on who, what they need, and any dates. Examples:
- "Kevin Chang asking about 2x passenger vans for March 30 pickup"
- "Cognito form: Wieden+Kennedy rental agreement submitted for Nike MM UConn job"
- "Miki from Toboggan reporting mirror damage on returned cargo van"

Just the sentence, no quotes.`

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 60,
      messages: [{ role: "user", content: prompt }]
    })

    return response.content[0].type === "text" ? response.content[0].text.trim() : snippet.slice(0, 100)
  } catch {
    return snippet.slice(0, 100)
  }
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
          userId: "me", labelIds: ["INBOX"], maxResults: 100, q: "newer_than:1d",
        })

        const messages = listRes.data.messages || []
        let processed = 0, skipped = 0, errors = 0

        const account = await prisma.emailAccount.upsert({
          where: { emailAddress: email },
          create: { emailAddress: email, accessToken: "service-account", isActive: true, userId: systemUser.id },
          update: { isActive: true },
        })

        for (const msg of messages) {
          try {
            const existing = await prisma.emailMessage.findUnique({ where: { gmailMessageId: msg.id! } })
            if (existing) { skipped++; continue }

            const full = await gmail.users.messages.get({ userId: "me", id: msg.id!, format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] })
            const get = (h: string) => full.data.payload?.headers?.find(x => x.name === h)?.value || ""

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

            // Upsert thread — get existing summary for context
            const existingThread = await prisma.emailThread.findUnique({ where: { gmailThreadId: gmailThreadId! } })

            // Generate AI summary using previous summary as context
            const aiSummary = await generateThreadSummary(
              subject,
              snippet,
              fromAddress,
              existingThread?.aiSummary || null
            )

            // Upsert thread with updated summary
            const thread = await prisma.emailThread.upsert({
              where: { gmailThreadId: gmailThreadId! },
              create: {
                gmailThreadId: gmailThreadId!,
                subject,
                lastMessageAt: sentAt,
                messageCount: 1,
                aiSummary,
                aiSummaryAt: new Date(),
              },
              update: {
                lastMessageAt: sentAt,
                messageCount: { increment: 1 },
                aiSummary,
                aiSummaryAt: new Date(),
              },
            })

            await prisma.emailMessage.create({
              data: {
                emailAccountId: account.id,
                threadId: thread.id,
                gmailMessageId: msg.id!,
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
