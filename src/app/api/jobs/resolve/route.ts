import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { resolveJob, type ResolveJobContext } from '@/lib/jobs/resolveJob'

export const dynamic = 'force-dynamic'

/**
 * POST /api/jobs/resolve — the Job-as-root resolver endpoint.
 *
 * PURE: ranks candidate existing Jobs for the given context and
 * returns a pre-filled draft. Creates NOTHING — creation happens via
 * POST /api/jobs only after the agent explicitly chooses "New Job" in
 * the JobResolverModal.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = (await req.json().catch(() => ({}))) as ResolveJobContext
    const hasSignal =
      body.companyId || body.companyName || body.contactEmail || body.jobNameHint || body.planyoCartId || body.threadId
    if (!hasSignal) {
      return NextResponse.json({ error: 'at least one identity signal required' }, { status: 400 })
    }
    const result = await resolveJob(body)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[jobs/resolve]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
