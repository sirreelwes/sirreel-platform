import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { gmailMessageId, userEmail } = await req.json()
  if (!gmailMessageId || !userEmail) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  await prisma.$executeRaw`
    INSERT INTO dismissed_emails (gmail_message_id, user_email)
    VALUES (${gmailMessageId}, ${userEmail})
    ON CONFLICT (gmail_message_id, user_email) DO NOTHING
  `
  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const userEmail = new URL(req.url).searchParams.get('user') || ''
  if (!userEmail) return NextResponse.json({ ids: [] })
  const rows = await prisma.$queryRaw<any[]>`
    SELECT gmail_message_id FROM dismissed_emails WHERE user_email = ${userEmail}
  `
  return NextResponse.json({ ids: rows.map(r => r.gmail_message_id) })
}
