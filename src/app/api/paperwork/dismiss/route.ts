import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  DISMISS_REASONS,
  countPaperworkReviewQueue,
  isReviewKind,
} from '@/lib/paperwork/reviewQueue'

export const dynamic = 'force-dynamic'

/**
 * POST/DELETE /api/paperwork/dismiss — skip a row off the review queue,
 * and put it back.
 *
 * Wes, 2026-09-11: "some COIs are resubmits or just need to be dismissed.
 * I'd like to be able to mark skip or handled so that they don't trigger
 * the alert." Before this the only exit from the queue was APPROVED — a
 * statement about the insurance, made to silence a badge. The dismissal is
 * stored beside the document instead of on it, so nothing else in HQ reads
 * a skipped certificate as verified.
 *
 * Undo is a delete of that one row, addressed by its unique (kind,
 * sourceId) — never a pattern sweep (CLAUDE.md hard rules).
 */

const REASONS = new Set(DISMISS_REASONS.map((r) => r.value as string))

function parseTarget(body: { kind?: unknown; sourceId?: unknown }) {
  const kind = body.kind
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : ''
  if (!isReviewKind(kind) || !sourceId) return null
  return { kind, sourceId }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    kind?: unknown
    sourceId?: unknown
    reason?: unknown
    note?: unknown
  }
  const target = parseTarget(body)
  if (!target) {
    return NextResponse.json({ error: 'kind and sourceId are required' }, { status: 400 })
  }

  const reason =
    typeof body.reason === 'string' && REASONS.has(body.reason) ? body.reason : 'HANDLED'
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) || null : null

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })

  const dismissal = await prisma.paperworkDismissal.upsert({
    where: { kind_sourceId: { kind: target.kind, sourceId: target.sourceId } },
    create: { ...target, reason, note, dismissedById: user?.id ?? null },
    update: { reason, note, dismissedById: user?.id ?? null, createdAt: new Date() },
    select: {
      createdAt: true,
      reason: true,
      note: true,
      dismissedBy: { select: { name: true } },
    },
  })

  return NextResponse.json({
    ok: true,
    dismissal: {
      at: dismissal.createdAt.toISOString(),
      by: dismissal.dismissedBy?.name ?? null,
      reason: dismissal.reason,
      note: dismissal.note,
    },
    // The caller is the nav's own page — hand back the fresh badge number
    // rather than making it poll for a change it just caused.
    count: (await countPaperworkReviewQueue()).total,
  })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { kind?: unknown; sourceId?: unknown }
  const target = parseTarget(body)
  if (!target) {
    return NextResponse.json({ error: 'kind and sourceId are required' }, { status: 400 })
  }

  await prisma.paperworkDismissal
    .delete({ where: { kind_sourceId: { kind: target.kind, sourceId: target.sourceId } } })
    // Already gone is the outcome the caller asked for.
    .catch(() => null)

  return NextResponse.json({ ok: true, count: (await countPaperworkReviewQueue()).total })
}
