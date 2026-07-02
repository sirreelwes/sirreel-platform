import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const { alertId, userEmail } = await req.json()
  if (!alertId || !userEmail) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  await prisma.$executeRaw`
    UPDATE alerts
    SET dismissed_by = array_append(dismissed_by, ${userEmail}),
        updated_at = now()
    WHERE id = ${alertId}
  `
  return NextResponse.json({ ok: true })
}
