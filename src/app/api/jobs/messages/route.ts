import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const rwOrder = new URL(req.url).searchParams.get('rwOrder')
  if (!rwOrder) return NextResponse.json({ error: 'rwOrder required' }, { status: 400 })
  const messages = await prisma.$queryRaw<{
    id: string
    rw_order_number: string
    user_name: string | null
    user_email: string | null
    content: string
    created_at: Date
  }[]>`
    SELECT id, rw_order_number, user_name, user_email, content, created_at
    FROM job_messages WHERE rw_order_number = ${rwOrder}
    ORDER BY created_at ASC
  `
  return NextResponse.json({ ok: true, messages })
}

// Identity comes from the session — NOT from the request body. The
// prior shape accepted userName/userEmail in the body, which let
// anyone post a message under any name/email. Tier-1 audit fix.
export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { rwOrder, content } = await req.json()
  if (!rwOrder || !content) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  // Pull the canonical name from the User row; the session may carry
  // a stale display name. Email is the stable lookup key.
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { name: true, email: true },
  })
  const userName = user?.name ?? session.user.name ?? null
  const userEmail = user?.email ?? session.user.email

  await prisma.$executeRaw`
    INSERT INTO job_messages (rw_order_number, user_name, user_email, content)
    VALUES (${rwOrder}, ${userName}, ${userEmail}, ${content})
  `
  return NextResponse.json({ ok: true })
}
