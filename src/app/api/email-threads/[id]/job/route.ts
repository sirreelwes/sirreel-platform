import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/email-threads/[id]/job — attach/detach a thread to a Job
 * (email-in-Job, Job-as-root step 6).
 *
 * Body: { jobId: string | null }. [id] accepts EmailThread.id or the
 * raw Gmail thread id. OPERATOR-EXPLICIT only — nothing calls this
 * without an agent having chosen the Job (ThreadDrawer resolver,
 * Quick Reply resolution, inquiry conversion). New messages inherit
 * automatically by joining the thread.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const jobId = body.jobId === null ? null : typeof body.jobId === 'string' ? body.jobId : undefined
  if (jobId === undefined) {
    return NextResponse.json({ error: 'jobId (string) or null required' }, { status: 400 })
  }

  const thread = await prisma.emailThread.findFirst({
    where: { OR: [{ id: params.id }, { gmailThreadId: params.id }] },
    select: { id: true },
  })
  if (!thread) return NextResponse.json({ error: 'thread not found' }, { status: 404 })

  if (jobId) {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, jobCode: true, name: true } })
    if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })
    // onlyIfUnfiled: side-effect callers (Quick Reply's post-resolution
    // filing) never re-point a thread an operator already filed; the
    // drawer's explicit attach omits it and overwrites.
    if (body.onlyIfUnfiled === true) {
      const r = await prisma.emailThread.updateMany({
        where: { id: thread.id, jobId: null },
        data: { jobId: job.id },
      })
      return NextResponse.json({ ok: true, jobId: job.id, jobCode: job.jobCode, jobName: job.name, filed: r.count > 0 })
    }
    await prisma.emailThread.update({ where: { id: thread.id }, data: { jobId: job.id } })
    return NextResponse.json({ ok: true, jobId: job.id, jobCode: job.jobCode, jobName: job.name, filed: true })
  }
  await prisma.emailThread.update({ where: { id: thread.id }, data: { jobId: null } })
  return NextResponse.json({ ok: true, jobId: null })
}
