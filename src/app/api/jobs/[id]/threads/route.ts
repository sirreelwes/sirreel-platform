import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/jobs/[id]/threads — the Job's filed email threads
 * (email-in-Job, step 6). Threads land here via operator-explicit
 * attach (ThreadDrawer), Quick Reply resolution, or inquiry
 * conversion; new messages inherit by joining the thread.
 *
 * Returns each thread with its messages (asc, capped at 25 — the Job
 * page renders them collapsible; a monster thread's tail is the part
 * that matters and is within the cap for every thread we have).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const threads = await prisma.emailThread.findMany({
    where: { jobId: params.id },
    orderBy: { lastMessageAt: 'desc' },
    take: 20,
    select: {
      id: true,
      subject: true,
      lastMessageAt: true,
      messageCount: true,
      lastDirection: true,
      messages: {
        orderBy: { sentAt: 'asc' },
        take: 25,
        select: {
          id: true,
          fromAddress: true,
          toAddresses: true,
          subject: true,
          snippet: true,
          bodyText: true,
          direction: true,
          sentAt: true,
          attachmentCount: true,
        },
      },
    },
  })

  return NextResponse.json({ threads })
}
