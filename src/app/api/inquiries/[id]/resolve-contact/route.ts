import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { ensureInquiryContact } from '@/lib/inquiries/resolveContact'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Turn the sender of an inquiry into a real Person, and hand back what
 * we know about them so the caller can prefill the form.
 *
 * Wes 2026-08-25: "the email should be self populated from the incoming
 * email and the name should populate if associated with the email … right
 * now if you type a name you get the error." Inquiry.personId was NULL on
 * every row, so anything downstream that needed a contact refused.
 *
 * POST because it can create a Person. Idempotent — safe to call every
 * time the Quick Respond flow opens.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  try {
    const result = await ensureInquiryContact(id)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not resolve the inquiry contact'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
