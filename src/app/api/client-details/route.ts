import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/client-details?inquiryIds=a,b,c   (batch — the inbound list)
 * GET /api/client-details?bookingId=…        (single — the gantt pop-up)
 *
 * Pending client answers to "what's the production company and project
 * name?", typed on the no-login /details/<token> page. Staff-only read;
 * the write side is the public route.
 *
 * Batched by inquiryIds because the inbound queue renders many rows and a
 * per-row fetch would be N requests on a 60s poll.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const bookingId = searchParams.get('bookingId')
  const inquiryIds = (searchParams.get('inquiryIds') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200)

  if (!bookingId && inquiryIds.length === 0) {
    return NextResponse.json({ ok: true, replies: [] })
  }

  const replies = await prisma.clientDetailReply.findMany({
    where: {
      status: 'PENDING',
      ...(bookingId ? { bookingId } : { inquiryId: { in: inquiryIds } }),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      inquiryId: true,
      bookingId: true,
      companyName: true,
      projectName: true,
      sentToEmail: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ ok: true, replies })
}
