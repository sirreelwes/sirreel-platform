import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { sendStageReadyToSignEmail } from '@/lib/paperwork/stageReadyEmail'

export const dynamic = 'force-dynamic'

/**
 * POST /api/paperwork/[token]/resend-signing-link
 *
 * Agent-initiated re-send of the stage "ready to sign" email — the
 * intentional escape hatch from the once-only auto-send guard. Still
 * refuses when terms are incomplete, the contract is already signed,
 * or no client email is on file (helper enforces all three).
 */
export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await sendStageReadyToSignEmail(params.token, { force: true })
    return NextResponse.json(result, { status: result.sent ? 200 : 409 })
  } catch (err: any) {
    return NextResponse.json({ sent: false, reason: err.message }, { status: 500 })
  }
}
