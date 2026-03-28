import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function generateSummary(
  subject: string,
  snippet: string,
  fromAddress: string
): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 60,
      messages: [{
        role: "user",
        content: `You summarize emails for SirReel, a production vehicle rental company in LA.

From: ${fromAddress}
Subject: ${subject}
Preview: ${snippet?.slice(0, 200) || ''}

Write ONE sentence (max 15 words) describing what this email is about. Focus on who, what they need, and any action needed. Be specific — include names, job names, vehicle types if mentioned.

Examples:
- "Donovan from Anchor Stone confirmed the Cloaked quote — ready for paperwork"
- "Kevin Chang asking about 2 passenger vans for March 30 pickup"
- "Cognito form: Wieden+Kennedy rental agreement submitted for Nike job"
- "Miki from Toboggan reporting mirror damage on returned cargo van"
- "Chelsea completed the rental agreement for Beyond Studios"

Just the sentence, no quotes, no punctuation at end.`
      }]
    })
    return response.content[0].type === "text" ? response.content[0].text.trim() : snippet?.slice(0, 100) || subject
  } catch {
    return snippet?.slice(0, 100) || subject
  }
}

export async function POST(req: NextRequest) {
  try {
    const { limit = 1 } = await req.json().catch(() => ({}))

    // Find threads without AI summaries
    const threads = await prisma.emailThread.findMany({
      where: { aiSummary: null },
      include: {
        messages: {
          where: { direction: "inbound" },
          orderBy: { sentAt: "desc" },
          take: 1,
          select: { fromAddress: true, subject: true, snippet: true }
        }
      },
      orderBy: { lastMessageAt: "desc" },
      take: limit,
    })

    if (threads.length === 0) {
      return NextResponse.json({ ok: true, message: "All threads already have summaries", processed: 0 })
    }

    let processed = 0
    let errors = 0

    for (const thread of threads) {
      const msg = thread.messages[0]
      if (!msg) continue

      try {
        const summary = await generateSummary(
          thread.subject,
          msg.snippet || "",
          msg.fromAddress
        )

        await prisma.emailThread.update({
          where: { id: thread.id },
          data: { aiSummary: summary, aiSummaryAt: new Date() }
        })
        processed++
      } catch {
        errors++
      }

      // Small delay to avoid rate limiting
      // no delay
    }

    const remaining = await prisma.emailThread.count({ where: { aiSummary: null } })

    return NextResponse.json({
      ok: true,
      processed,
      errors,
      remaining,
      message: remaining > 0
        ? `Processed ${processed} threads. ${remaining} remaining — run again to continue.`
        : `All done! Processed ${processed} threads.`
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}

export async function GET() {
  const total = await prisma.emailThread.count()
  const withSummary = await prisma.emailThread.count({ where: { aiSummary: { not: null } } })
  const without = total - withSummary
  return NextResponse.json({ total, withSummary, without })
}
