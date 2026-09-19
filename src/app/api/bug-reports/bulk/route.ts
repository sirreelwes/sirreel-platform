/**
 * Close (or reopen) many improvements at once.
 *
 * Wes 2026-09-19: "make sure the reported bugs have a better system than
 * manually going through one by one and checking whether fixed or not."
 *
 * Two things make that true, and this route is the first: a batch handed
 * to Claude comes back as a batch, so the board is cleared in one action
 * rather than one row at a time. The second lives in `/improvements`,
 * which stamps the COMMIT that fixed each one — the honest answer to "is
 * it actually fixed" is a SHA you can look at, not somebody re-testing.
 *
 * Accepts either explicit `ids` or a `batchId` (everything handed over in
 * that batch). ADMIN/MANAGER.
 */
import { NextRequest, NextResponse } from 'next/server'
import { BugStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-admin'

export const dynamic = 'force-dynamic'

const CLOSED: BugStatus[] = ['FIXED', 'WONT_FIX', 'ANSWERED', 'DUPLICATE']

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const json = await req.json().catch(() => ({}))
  const status = typeof json.status === 'string' ? json.status : ''
  if (!(Object.values(BugStatus) as string[]).includes(status)) {
    return NextResponse.json({ error: 'unknown status' }, { status: 400 })
  }
  const note = typeof json.note === 'string' ? json.note.trim().slice(0, 2000) || null : null
  const commit = typeof json.commit === 'string' ? json.commit.trim().slice(0, 80) || null : null

  const ids: string[] = Array.isArray(json.ids) ? json.ids.filter((i: unknown) => typeof i === 'string') : []
  const batchId = typeof json.batchId === 'string' ? json.batchId : null
  if (!ids.length && !batchId) {
    return NextResponse.json({ error: 'nothing selected' }, { status: 400 })
  }

  try {
    const where = batchId ? { fixBatchId: batchId } : { id: { in: ids } }
    const affected = await prisma.bugReport.findMany({ where, select: { id: true } })
    if (!affected.length) return NextResponse.json({ error: 'nothing matched' }, { status: 404 })

    const closing = CLOSED.includes(status as BugStatus)
    await prisma.bugReport.updateMany({
      where,
      data: {
        status: status as BugStatus,
        resolvedAt: closing ? new Date() : null,
        resolvedByEmail: closing ? user.email : null,
        ...(note ? { resolutionNote: note } : {}),
        ...(commit ? { resolutionCommit: commit } : {}),
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'bug_report.bulk_update',
        entityType: 'bug_report_batch',
        entityId: batchId ?? `selection-${affected.length}`,
        newValues: { status, note, commit, ids: affected.map((a) => a.id) },
      },
    })

    return NextResponse.json({ ok: true, count: affected.length, ids: affected.map((a) => a.id), status })
  } catch (e) {
    console.error('[improvements] bulk update failed:', e)
    return NextResponse.json({ error: 'could not update those' }, { status: 500 })
  }
}
