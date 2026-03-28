import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { EmailCategory } from "@prisma/client"

export async function GET() {
  try {
    const threads = await prisma.emailThread.findMany({
      where: {
        messages: { some: { direction: "inbound" } }
      },
      select: {
        id: true,
        aiSummary: true,
        messages: {
          orderBy: { sentAt: "asc" },
          select: {
            id: true, fromAddress: true, toAddresses: true, subject: true,
            snippet: true, category: true, priority: true, status: true,
            sentAt: true, isRead: true, gmailMessageId: true, direction: true,
          }
        }
      },
      orderBy: { lastMessageAt: "desc" },
      take: 200,
    })

    const seenMsgIds = new Set<string>()

    const emails = threads
      .map(thread => {
        const msgs = thread.messages
        if (!msgs.length) return null

        const lastInbound = [...msgs].reverse().find(m => m.direction === "inbound")
        if (!lastInbound) return null

        const lastInboundTime = lastInbound.sentAt.getTime()
        const hasReply = msgs.some(
          m => m.direction === "outbound" && m.sentAt.getTime() > lastInboundTime
        )

        const waitMs = Date.now() - lastInboundTime
        const waitHours = Math.floor(waitMs / 3600000)
        const waitMins = Math.floor(waitMs / 60000)

        return {
          ...lastInbound,
          sentAt: lastInbound.sentAt.toISOString(),
          threadId: thread.id,
          aiSummary: thread.aiSummary,
          messageCount: msgs.length,
          needsReply: !hasReply,
          hasReply,
          waitHours,
          waitMins,
          waitLabel: waitHours > 24
            ? `${Math.floor(waitHours / 24)}d`
            : waitHours > 0
            ? `${waitHours}h`
            : `${waitMins}m`,
          urgencyFromWait:
            waitHours >= 24 ? 0 :
            waitHours >= 4  ? 1 :
            waitHours >= 1  ? 2 :
            3,
        }
      })
      .filter(Boolean)
      .filter(e => {
        if (!e) return false
        if (seenMsgIds.has(e.gmailMessageId)) return false
        seenMsgIds.add(e.gmailMessageId)
        return true
      }) as any[]

    const needsReply = emails.filter(e => e.needsReply)
    const replied = emails.filter(e => !e.needsReply)
    const urgent = needsReply.filter(e => e.priority <= 1 || e.urgencyFromWait <= 1)
    const unassigned = needsReply.filter(e =>
      [EmailCategory.BOOKING_INQUIRY, EmailCategory.RENTAL_REQUEST, EmailCategory.COMPLAINT, EmailCategory.FLEET_ISSUE].includes(e.category as any)
    )

    const categoryCounts = await prisma.emailMessage.groupBy({
      by: ["category"],
      where: { direction: "inbound" },
      _count: { id: true },
    })

    const alerts = needsReply.filter(e => e.priority <= 2 || e.urgencyFromWait <= 1).length

    return NextResponse.json({
      ok: true,
      alerts,
      urgent,
      unassigned,
      all: emails,
      needsReply,
      replied,
      summary: categoryCounts.map(c => ({ category: c.category, count: c._count.id })),
      message: needsReply.length > 0
        ? `${needsReply.length} thread(s) waiting for reply`
        : "All threads replied",
    })
  } catch (err: any) {
    console.error("[check-replies] error:", err)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
