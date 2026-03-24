import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { EmailCategory } from "@prisma/client"

export async function GET() {
  try {
    // Get latest message per thread
    const threads = await prisma.emailThread.findMany({
      where: {
        messages: {
          some: { direction: "inbound" }
        }
      },
      include: {
        messages: {
          where: { direction: "inbound" },
          orderBy: { sentAt: "desc" },
          take: 1,
          select: {
            id: true, fromAddress: true, subject: true, snippet: true,
            category: true, priority: true, status: true, sentAt: true, isRead: true,
          }
        }
      },
      orderBy: { lastMessageAt: "desc" },
      take: 50,
    })

    // Flatten to one email per thread (the latest)
    const emails = threads
      .map(t => t.messages[0])
      .filter(Boolean)
      .map(e => ({ ...e, sentAt: e.sentAt.toISOString() }))

    const urgent = emails.filter(e => e.priority <= 1)
    const unassigned = emails.filter(e =>
      e.priority <= 2 &&
      [EmailCategory.BOOKING_INQUIRY, EmailCategory.RENTAL_REQUEST, EmailCategory.COMPLAINT, EmailCategory.FLEET_ISSUE].includes(e.category as any)
    )

    const categoryCounts = await prisma.emailMessage.groupBy({
      by: ["category"],
      where: { direction: "inbound" },
      _count: { id: true },
    })

    const alerts = emails.filter(e => e.priority <= 2).length
    return NextResponse.json({
      ok: true,
      alerts,
      urgent,
      unassigned,
      all: emails,
      summary: categoryCounts.map(c => ({ category: c.category, count: c._count.id })),
      message: alerts > 0 ? `${alerts} thread(s) need attention` : "Inbox clear",
    })
  } catch (err: any) {
    console.error("[check-replies] error:", err)
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
