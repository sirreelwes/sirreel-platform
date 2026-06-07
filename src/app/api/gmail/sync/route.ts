import { NextResponse } from "next/server"
import { google } from "googleapis"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"
import { runMessageExtractionForId } from "@/lib/ai/messageExtractor"
import { inferFormTypeFromSubject } from "@/lib/email/inferFormType"
import { WATCHED_INBOXES } from "@/lib/email/watchedInboxes"
import { extractRoutingHeaders, ROUTING_HEADER_NAMES } from "@/lib/email/routingHeaders"
import { shouldIngest, recordIngestDecision } from "@/lib/email/ingestFilter"
import { onboardFromEmail } from "@/lib/claims/onboardFromEmail"
import { shouldOnboardClaimEmail } from "@/lib/claims/shouldOnboardClaimEmail"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

            const full = await gmail.users.messages.get({ userId: "me", id: msg.id!, format: "metadata", metadataHeaders: ["From", "Subject", "Date", "Message-ID", "In-Reply-To", ...ROUTING_HEADER_NAMES] })
            const get = (h: string) => full.data.payload?.headers?.find(x => x.name?.toLowerCase() === h.toLowerCase())?.value || ""

            const fromAddress = get("From")
            const subject = get("Subject") || "(no subject)"
            const snippet = full.data.snippet || ""
            const sentAt = new Date(parseInt(full.data.internalDate || "0"))
            const gmailThreadId = full.data.threadId || msg.id
            const labelIds = full.data.labelIds || []
            const rfc822MessageId = get("Message-ID") || get("Message-Id") || null
            const inReplyTo = get("In-Reply-To") || null
            const routingHeaders = extractRoutingHeaders(full.data.payload?.headers)
            let duplicateOfId: string | null = null
            if (rfc822MessageId) {
              const dupExisting = await prisma.emailMessage.findFirst({
                where: { rfc822MessageId, duplicateOfId: null },
                select: { id: true },
                orderBy: { createdAt: "asc" },
              }).catch(() => null)
              if (dupExisting) duplicateOfId = dupExisting.id
            }

            // Skip internal team emails
            const emailUser = email.split("@")[0]
            if (fromAddress.toLowerCase().includes(emailUser + "@sirreel.com")) { skipped++; continue }
            if (fromAddress.toLowerCase().match(/(jose|oliver|ana|dani|wes|hugo|julian|chris|christian)@sirreel\.com/)) { skipped++; continue }

            const { category, priority } = quickTriage(subject, snippet)
            if (priority === 9) { skipped++; continue }

            // Per-inbox ingest filter. Same contract as pubsub — see
            // src/lib/email/ingestFilter.ts. Sync runs with format=
            // "metadata", so bodyText/bodyHtml are null at this point;
            // the SALES body-side rules will simply not fire, leaving
            // subject + sender as the only signals. That's acceptable
            // for the backfill / debug path this route serves.
            const decision = shouldIngest({
              inbox: email,
              direction: 'INBOUND',
              fromAddress,
              subject,
              bodyText: null,
              bodyHtml: null,
              routingHeaders,
            })
            void recordIngestDecision(email, decision)
            if (!decision.keep) { skipped++; continue }

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

            const created = await prisma.emailMessage.create({
              data: {
                emailAccountId: account.id,
                threadId: thread.id,
                gmailMessageId: msg.id!,
                rfc822MessageId,
                inReplyTo,
                routingHeaders: routingHeaders ?? undefined,
                duplicateOfId,
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
                inferredFormType: inferFormTypeFromSubject(subject),
              },
              select: { id: true },
            })
            // Fire-and-forget AI extraction; cron is the safety net.
            if (!duplicateOfId) {
              void runMessageExtractionForId(created.id).catch((err) =>
                console.warn('[sync] message extraction failed:', created.id, err instanceof Error ? err.message : err),
              )
            }
            // claims@ onboarding bridge — same gate as pubsub (shared
            // helper). Catches the backfill-path equivalent: if sync
            // pulls a forwarded claim email that pubsub missed, we
            // still onboard it. Helper re-fetches from Gmail for body +
            // attachments since sync uses format=metadata.
            if (shouldOnboardClaimEmail({ inbox: email, fromAddress })) {
              const messageId = created.id
              void onboardFromEmail(messageId).catch((err) =>
                console.warn('[sync] claims onboarding failed:', messageId, err instanceof Error ? err.message : err),
              )
            }
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
