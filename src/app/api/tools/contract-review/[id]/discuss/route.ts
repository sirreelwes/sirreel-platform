import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { discussClause } from '@/lib/contracts/discussClause'

export const dynamic = 'force-dynamic'

/**
 * POST /api/tools/contract-review/[id]/discuss — one turn of the
 * per-clause Discuss thread. Body: { clauseKey, changeIndex, message }.
 * Persists the operator message, gets Claude's reply with full clause
 * context, persists that too, returns both. Internal-only: nothing in a
 * Discuss thread is ever sent to the client.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const clauseKey = typeof body.clauseKey === 'string' ? body.clauseKey.trim() : ''
  const changeIndex =
    typeof body.changeIndex === 'number' && Number.isInteger(body.changeIndex) && body.changeIndex >= 0
      ? body.changeIndex
      : null
  const message = typeof body.message === 'string' ? body.message : ''
  if (!clauseKey || changeIndex === null) {
    return NextResponse.json({ error: 'clauseKey and changeIndex (int) required' }, { status: 400 })
  }

  const result = await discussClause({
    reviewId: params.id,
    clauseKey,
    changeIndex,
    message,
    userId: sessionUser.id,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({
    ok: true,
    userMessage: result.userMessage,
    assistantMessage: result.assistantMessage,
  })
}
