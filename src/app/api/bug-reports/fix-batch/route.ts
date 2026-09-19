/**
 * "Hand to Claude" — Wes ticks reports on the board and presses one button.
 *
 * Stamps the selected reports with a shared batch id, moves them to
 * IN_PROGRESS so nobody picks up something already being worked, and
 * returns the composed brief for the clipboard. The same batch is what
 * `npx tsx scripts/fix-queue.ts` pulls locally, so the pasted brief and the
 * pulled one are the same document.
 *
 * ADMIN/MANAGER — handing work over is a board action.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-admin'
import { composeFixBrief, type BriefReport } from '@/lib/bugs/fixBrief'
import { SEVERITY_RANK } from '@/lib/bugs/vocab'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const json = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(json.ids) ? json.ids.filter((i: unknown) => typeof i === 'string') : []
  if (ids.length === 0) return NextResponse.json({ error: 'nothing selected' }, { status: 400 })
  if (ids.length > 50) return NextResponse.json({ error: 'too many at once — pick fewer' }, { status: 400 })

  try {
    const reports = await prisma.bugReport.findMany({
      where: { id: { in: ids }, duplicateOfId: null },
      include: { _count: { select: { duplicates: true } } },
    })
    if (reports.length === 0) return NextResponse.json({ error: 'nothing to hand over' }, { status: 404 })

    // Short and sayable — it goes in a commit message and gets read aloud.
    const batchId = `fix-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`

    await prisma.bugReport.updateMany({
      where: { id: { in: reports.map((r) => r.id) } },
      data: { fixBatchId: batchId, queuedForFixAt: new Date(), status: 'IN_PROGRESS' },
    })

    const ordered: BriefReport[] = reports
      .map((r) => ({ ...r, duplicateCount: r._count.duplicates }))
      .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'bug_report.hand_to_claude',
        entityType: 'bug_report_batch',
        entityId: batchId,
        newValues: { count: reports.length, ids: reports.map((r) => r.id) },
      },
    })

    return NextResponse.json({
      ok: true,
      batchId,
      count: reports.length,
      brief: composeFixBrief(ordered, batchId),
    })
  } catch (e) {
    console.error('[bug-reports] fix-batch failed:', e)
    return NextResponse.json({ error: 'could not hand those over' }, { status: 500 })
  }
}
