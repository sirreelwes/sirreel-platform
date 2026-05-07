import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import type { ChangeDecision } from '@prisma/client'

export const dynamic = 'force-dynamic'

const VALID_DECISIONS: ChangeDecision[] = ['PENDING', 'ACCEPT', 'COUNTER', 'REJECT']

interface DecisionInput {
  clauseRef?: unknown
  changeType?: unknown
  changeIndex?: unknown
  decision?: unknown
  counterLanguage?: unknown
  note?: unknown
}

async function requireSessionUser() {
  const session = await getServerSession()
  if (!session?.user?.email) return null
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  return user
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sessionUser = await requireSessionUser()
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const review = await prisma.contractReview.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { id: true },
  })
  if (!review) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const decisions = Array.isArray((body as any).decisions) ? (body as any).decisions as DecisionInput[] : null
  if (!decisions || decisions.length === 0) {
    return NextResponse.json({ error: 'decisions[] required' }, { status: 400 })
  }

  const normalized: Array<{
    clauseRef: string
    changeType: string
    changeIndex: number
    decision: ChangeDecision
    counterLanguage: string | null
    note: string | null
  }> = []

  for (const d of decisions) {
    const clauseRef = typeof d.clauseRef === 'string' ? d.clauseRef.trim() : ''
    const changeType = typeof d.changeType === 'string' ? d.changeType.trim() : ''
    const changeIndex =
      typeof d.changeIndex === 'number' && Number.isInteger(d.changeIndex) && d.changeIndex >= 0
        ? d.changeIndex
        : null
    const decisionRaw = typeof d.decision === 'string' ? d.decision : ''
    const counterLanguage =
      typeof d.counterLanguage === 'string' && d.counterLanguage.trim().length > 0
        ? d.counterLanguage.trim()
        : null
    const note = typeof d.note === 'string' && d.note.trim().length > 0 ? d.note.trim() : null

    if (!clauseRef || !changeType || changeIndex === null) {
      return NextResponse.json(
        { error: 'Each decision needs clauseRef, changeType, changeIndex (int).' },
        { status: 400 }
      )
    }
    if (!(VALID_DECISIONS as readonly string[]).includes(decisionRaw)) {
      return NextResponse.json(
        { error: `Invalid decision "${decisionRaw}" for clause ${clauseRef}` },
        { status: 400 }
      )
    }
    const decision = decisionRaw as ChangeDecision
    if (decision === 'COUNTER' && !counterLanguage) {
      return NextResponse.json(
        { error: `counterLanguage required when decision=COUNTER (clause ${clauseRef})` },
        { status: 400 }
      )
    }

    normalized.push({ clauseRef, changeType, changeIndex, decision, counterLanguage, note })
  }

  const now = new Date()

  await prisma.$transaction(
    normalized.map((d) =>
      prisma.reviewChangeDecision.upsert({
        where: {
          review_change_unique: { reviewId: params.id, changeIndex: d.changeIndex },
        },
        create: {
          reviewId: params.id,
          clauseRef: d.clauseRef,
          changeType: d.changeType,
          changeIndex: d.changeIndex,
          decision: d.decision,
          counterLanguage: d.counterLanguage,
          note: d.note,
          decidedById: d.decision === 'PENDING' ? null : sessionUser.id,
          decidedAt: d.decision === 'PENDING' ? null : now,
        },
        update: {
          clauseRef: d.clauseRef,
          changeType: d.changeType,
          decision: d.decision,
          counterLanguage: d.counterLanguage,
          note: d.note,
          decidedById: d.decision === 'PENDING' ? null : sessionUser.id,
          decidedAt: d.decision === 'PENDING' ? null : now,
        },
      })
    )
  )

  const all = await prisma.reviewChangeDecision.findMany({
    where: { reviewId: params.id },
    orderBy: { changeIndex: 'asc' },
    include: {
      decidedBy: { select: { id: true, name: true, email: true } },
    },
  })

  return NextResponse.json({ ok: true, decisions: all })
}
