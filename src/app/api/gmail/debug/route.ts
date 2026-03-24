import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { EmailStatus, EmailCategory } from "@prisma/client"

export async function GET() {
  try {
    const total = await prisma.emailMessage.count()
    const byCategory = await prisma.emailMessage.groupBy({
      by: ["category"],
      _count: { id: true },
    })
    const byPriority = await prisma.emailMessage.groupBy({
      by: ["priority"],
      _count: { id: true },
    })
    const sample = await prisma.emailMessage.findMany({
      take: 3,
      orderBy: { sentAt: "desc" },
      select: { fromAddress: true, subject: true, category: true, priority: true, direction: true, status: true }
    })

    const urgent = await prisma.emailMessage.findMany({
      where: { direction: "inbound", priority: { lte: 2 } },
      take: 5,
      select: { fromAddress: true, subject: true, category: true, priority: true }
    })

    const dbUrl = (process.env.DATABASE_URL || "").slice(0, 50) + "..."
    return NextResponse.json({ total, byCategory, byPriority, sample, urgent, dbUrl })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
