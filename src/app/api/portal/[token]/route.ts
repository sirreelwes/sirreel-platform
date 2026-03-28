import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const request = await prisma.paperworkRequest.findUnique({
      where: { token: params.token },
      include: {
        booking: {
          include: {
            company: true,
            person: true,
            agent: true,
            items: { include: { category: true } }
          }
        }
      }
    })
    if (!request) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })
    return NextResponse.json({ booking: request.booking, request })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
