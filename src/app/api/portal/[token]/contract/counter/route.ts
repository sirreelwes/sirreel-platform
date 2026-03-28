import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const request = await prisma.paperworkRequest.findUnique({
      where: { token: params.token },
      include: { booking: { include: { company: true, person: true } } }
    })
    if (!request) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })

    const { action, counterText } = await req.json()
    // action: 'approve' | 'counter' | 'reject'

    const statusMap: Record<string, string> = {
      approve: 'approved',
      counter: 'counter_sent',
      reject: 'rejected',
    }

    await prisma.$executeRawUnsafe(
      `UPDATE paperwork_requests SET 
        contract_redline_status=$1,
        contract_approved_at=$2
      WHERE token=$3`,
      statusMap[action] || 'pending_review',
      new Date(),
      params.token
    )

    // TODO: send email to client with action + counterText
    // For now just return success

    return NextResponse.json({ ok: true, action, status: statusMap[action] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
