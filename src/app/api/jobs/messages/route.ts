import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const rwOrder = new URL(req.url).searchParams.get('rwOrder')
  if (!rwOrder) return NextResponse.json({ error: 'rwOrder required' }, { status: 400 })
  const messages = await prisma.$queryRaw<any[]>`
    SELECT id, rw_order_number, user_name, user_email, content, created_at
    FROM job_messages WHERE rw_order_number = ${rwOrder}
    ORDER BY created_at ASC
  `
  return NextResponse.json({ ok: true, messages })
}

export async function POST(req: NextRequest) {
  const { rwOrder, userName, userEmail, content } = await req.json()
  if (!rwOrder || !content) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  await prisma.$executeRaw`
    INSERT INTO job_messages (rw_order_number, user_name, user_email, content)
    VALUES (${rwOrder}, ${userName}, ${userEmail}, ${content})
  `
  return NextResponse.json({ ok: true })
}
