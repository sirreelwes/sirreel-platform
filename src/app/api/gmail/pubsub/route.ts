import { NextRequest, NextResponse } from "next/server"
import { google } from "googleapis"
import { prisma } from "@/lib/prisma"
import { getMessageDirection, parseRecipientHeader } from "@/lib/email/direction"
import { WATCHED_INBOXES } from "@/lib/email/watchedInboxes"
import { extractBodyFromGmailPayload, type GmailMessagePart } from "@/lib/email/body"
import { extractRoutingHeaders } from "@/lib/email/routingHeaders"
import { classifyReply } from "@/lib/email/replyClassifier"
import { applyReplyClassificationToCadence } from "@/lib/cadence/applyReplyClassification"
import { runMessageExtractionForId } from "@/lib/ai/messageExtractor"
import { inferFormTypeFromSubject } from "@/lib/email/inferFormType"
import { onboardFromEmail } from "@/lib/claims/onboardFromEmail"
import { shouldOnboardClaimEmail } from "@/lib/claims/shouldOnboardClaimEmail"
import { shouldIngest, recordIngestDecision } from "@/lib/email/ingestFilter"

// Centralized — see src/lib/email/watchedInboxes.ts. Alias kept for
// the existing in-file references; same array, single source of
// truth so the four ingest paths can't drift apart again.
const MONITORED = WATCHED_INBOXES

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
  // Pull both INBOX and SENT — Gmail's label model is mutually exclusive
  // (a message lives in exactly one), so we issue two list calls and
  // concat. Without SENT, outbound agent messages never enter the DB and
  // EmailThread.lastDirection can't be maintained.
  const [inboxList, sentList] = await Promise.all([
    gmail.users.messages.list({ userId: "me", labelIds: ["INBOX"], maxResults: 10, q: "newer_than:1d" }),
    gmail.users.messages.list({ userId: "me", labelIds: ["SENT"],  maxResults: 10, q: "newer_than:1d" }),
  ])
  const messages = [...(inboxList.data.messages || []), ...(sentList.data.messages || [])]
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

    // format:"full" returns the entire MIME tree so we can extract the
    // text/plain (or html-converted) body and count attachments. Headers
    // come along for free — no metadataHeaders restriction needed.
    const full = await gmail.users.messages.get({
      userId: "me", id: msg.id, format: "full",
    })

    const headers = full.data.payload?.headers || []
    const get = (n: string) => headers.find((h: any) => h.name?.toLowerCase() === n.toLowerCase())?.value || ""

    const fromAddress = get("From")
    const subject = get("Subject") || "(no subject)"
    const snippet = full.data.snippet || ""
    const sentAt = new Date(parseInt(full.data.internalDate || "0"))
    const gmailThreadId = full.data.threadId || msg.id
    const labelIds = full.data.labelIds || []
    const body = extractBodyFromGmailPayload(full.data.payload as GmailMessagePart | undefined)
    // RFC 822 Message-Id / In-Reply-To. Message-Id is set by the sending MTA
    // and shared across every inbox that receives the email — it's how we
    // dedup the same message landing in info@/jose@/oliver@/ana@.
    const rfc822MessageId = get("Message-ID") || get("Message-Id") || null
    const inReplyTo = get("In-Reply-To") || null
    // Routing headers — captures the original recipient on forwarded mail
    // (claims@ → ana@ etc.) so downstream classification can route on
    // true addressing instead of the inbox-of-record.
    const routingHeaders = extractRoutingHeaders(headers)

    // Cross-inbox dedup. Look up any older copy with this Message-ID; if one
    // exists, this row becomes a pointer to it. If we are the oldest, we stay
    // canonical and older inbox copies (if any later) will point at us.
    let duplicateOfId: string | null = null
    if (rfc822MessageId) {
      const existingCanonical = await prisma.emailMessage.findFirst({
        where: { rfc822MessageId, duplicateOfId: null },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }).catch(() => null)
      if (existingCanonical) {
        duplicateOfId = existingCanonical.id
      }
    }

    // Direction is now classified by the central helper. Outbound
    // messages (from any sirreel agent) ARE persisted so the thread's
    // last-direction state stays accurate. They're tagged
    // direction='outbound' on EmailMessage and so never appear in
    // suggested-inquiries (which filters direction='inbound') — there's
    // no risk of an outbound message creating an Inquiry.
    const direction = getMessageDirection(fromAddress)

    // toAddresses semantics differ by direction:
    //   OUTBOUND — store the real recipients parsed from the To: + Cc:
    //              headers. Without this, cold-outreach outbound
    //              (e.g. a quote send to a brand-new client with no
    //              prior inbound thread) can't match the contact on
    //              /crm/[id] timeline. Fall back to [email] when the
    //              headers are missing so the row is never empty.
    //   INBOUND  — keep [email] (the polled inbox). The dashboard's
    //              agent-load tally reads toAddresses[0] expecting
    //              the inbox; changing inbound semantics would break
    //              that surface without a follow-up. Scope this fix
    //              to outbound only.
    const toAddresses =
      direction === 'OUTBOUND'
        ? (() => {
            const parsed = [
              ...parseRecipientHeader(get('To')),
              ...parseRecipientHeader(get('Cc')),
            ]
            const deduped = Array.from(new Set(parsed))
            return deduped.length > 0 ? deduped : [email]
          })()
        : [email]

    const { category, priority } = quickTriage(subject, snippet)
    if (priority === 9) continue

    // Per-inbox ingest filter — drops noise BEFORE persistence + AI.
    // CLAIMS / PRESERVE modes are pass-through (claims@ and ana@/dani@
    // keep their existing store-all contract). SALES mode is a negative
    // junk filter (no-reply, calendars, bounces, newsletters — bias
    // inclusive). MONEY mode is positive triggers (invoice/payment
    // keywords or known billing sender). Outbound always kept (drives
    // thread state). Stats land in IngestFilterStat for tuning.
    const decision = shouldIngest({
      inbox: email,
      direction,
      fromAddress,
      subject,
      bodyText: body.bodyText,
      bodyHtml: body.bodyHtml,
      routingHeaders,
    })
    void recordIngestDecision(email, decision)
    if (!decision.keep) continue

    // Upsert the thread; directional timestamp + lastDirection are
    // updated below with max-semantics so out-of-order processing can't
    // overwrite a newer timestamp with an older one.
    const thread = await prisma.emailThread.upsert({
      where: { gmailThreadId },
      create: {
        gmailThreadId,
        subject,
        lastMessageAt: sentAt,
        messageCount: 1,
        lastInboundAt: direction === "INBOUND" ? sentAt : null,
        lastOutboundAt: direction === "OUTBOUND" ? sentAt : null,
        lastDirection: direction,
      },
      update: { lastMessageAt: sentAt, messageCount: { increment: 1 } },
    })

    // Advance the directional timestamp + lastDirection only if this
    // message is the new latest in its direction (and the new overall
    // latest, for lastDirection).
    const sameDirAt = direction === "INBOUND" ? thread.lastInboundAt : thread.lastOutboundAt
    if (!sameDirAt || sentAt > sameDirAt) {
      const otherDirAt = direction === "INBOUND" ? thread.lastOutboundAt : thread.lastInboundAt
      const isOverallLatest = !otherDirAt || sentAt >= otherDirAt
      await prisma.emailThread.update({
        where: { id: thread.id },
        data: {
          ...(direction === "INBOUND" ? { lastInboundAt: sentAt } : { lastOutboundAt: sentAt }),
          ...(isOverallLatest ? { lastDirection: direction } : {}),
        },
      })
    }

    const createdMessage = await prisma.emailMessage.create({
      data: {
        emailAccountId: account.id,
        threadId: thread.id,
        gmailMessageId: msg.id,
        rfc822MessageId,
        inReplyTo,
        routingHeaders: routingHeaders ?? undefined,
        duplicateOfId,
        fromAddress,
        toAddresses,
        subject,
        snippet,
        bodyText: body.bodyText,
        bodyHtml: body.bodyHtml,
        bodySource: body.bodySource,
        attachmentCount: body.attachmentCount,
        direction: direction.toLowerCase(), // legacy column uses lowercase
        sentAt,
        isRead: !labelIds.includes("UNREAD"),
        category: category as any,
        status: "TRIAGED" as any,
        priority,
        triageAt: new Date(),
        assignedToId: null,
        inferredFormType: inferFormTypeFromSubject(subject),
      },
    }).catch(() => null)

    // AI reply classification — fires on inbound messages on a thread that
    // already had at least one prior message (i.e., this is a reply, not a
    // first-touch). Duplicates and outbound messages skip. The classifier
    // never throws past us (returns UNCLEAR + confidence 0 on failure), so
    // any per-message error here doesn't take down the pubsub batch.
    if (
      createdMessage &&
      direction === 'INBOUND' &&
      !duplicateOfId &&
      thread.messageCount > 1 &&
      body.bodyText
    ) {
      try {
        const result = await classifyReply({
          jobName: subject,
          subject,
          bodyText: body.bodyText,
        })
        const updated = await prisma.emailMessage.update({
          where: { id: createdMessage.id },
          data: {
            replyClassification: result.classification,
            replyClassificationConfidence: result.confidence,
          },
          select: { companyId: true },
        })
        // Bridge classification → cadence state transition on a single open
        // quote order for this company. Multi-order companies skip auto-
        // transition until thread→order linking is in place.
        await applyReplyClassificationToCadence({
          emailMessageId: createdMessage.id,
          classification: result.classification,
          effectiveClassification: result.effectiveClassification,
          companyId: updated.companyId,
        }).catch((err) => console.warn('[pubsub] applyReplyClassification failed:', err))
      } catch (err) {
        console.warn('[pubsub] reply classification failed:', err)
      }
    }

    // Per-message AI extraction — fire-and-forget so we don't block the
    // pubsub batch on a Haiku call. The /api/cron/run-message-extraction
    // cron is the actual guarantee that every inbound row eventually gets
    // extracted, so if Vercel terminates this background task before it
    // finishes, the cron picks it up within 5 minutes.
    if (createdMessage && direction === 'INBOUND' && !duplicateOfId) {
      const messageId = createdMessage.id
      void runMessageExtractionForId(messageId).catch((err) => {
        console.warn('[pubsub] message extraction failed:', messageId, err instanceof Error ? err.message : err)
      })
    }

    // claims@ → claim onboarding bridge. Gated via shouldOnboardClaimEmail
    // (src/lib/claims/shouldOnboardClaimEmail.ts) so the contract stays in
    // one place across pubsub/sync/fetch. Re-gating on AUTHORSHIP (not
    // direction) is what catches the staff-forward-into-claims@ case —
    // those messages have a SirReel agent in From: and would have been
    // classified OUTBOUND under the old INBOUND-only gate. Helper is
    // additionally cross-inbox idempotent via rfc822MessageId. Fire-and-
    // forget; Sonnet + attachment downloads can take 10s+ and we don't
    // want to stall the batch.
    if (createdMessage && shouldOnboardClaimEmail({ inbox: email, fromAddress })) {
      const messageId = createdMessage.id
      void onboardFromEmail(messageId).catch((err) => {
        console.warn('[pubsub] claims onboarding failed:', messageId, err instanceof Error ? err.message : err)
      })
    }

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
