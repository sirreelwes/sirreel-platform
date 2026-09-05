import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { requestDriverFromClient, DriverRequestError } from '@/lib/drivers/requestDriverFromClient'

export const dynamic = 'force-dynamic'

/**
 * POST /api/jobs/[id]/driver-request — email the production's contact
 * asking them to name their driver from the portal. Body: { contactId? }.
 * Any signed-in staff session: it sends the client a link to their own
 * page, the same footprint as naming a driver.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { contactId?: string } | null
  try {
    const r = await requestDriverFromClient({ jobId: id, contactId: body?.contactId ?? null })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof DriverRequestError) return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('[jobs/driver-request]', e)
    return NextResponse.json({ error: 'Could not send that request.' }, { status: 500 })
  }
}
