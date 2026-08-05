import { NextRequest, NextResponse } from 'next/server'
import { confirmStageEntry } from '@/lib/public/stageContractEntry'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/stage-entry/[token] — the "Review & sign →" click from the
 * stage-contract email. Creates NOTHING: mints a fresh magic link and 303s
 * into the job portal, where the agent-prepared stage contract is already
 * surfaced for signature. Repeat clicks / forwarded links land in the SAME
 * portal. Invalid or expired → 303 back to the public stage-contract page,
 * which leaks nothing (the token is the only secret).
 */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const result = await confirmStageEntry(params.token || '')
  if (result.kind === 'redirect') return NextResponse.redirect(result.url, 303)
  // The public page lives on the marketing host (the portal host 404s
  // /stage-contract by allow-list).
  return NextResponse.redirect('https://sirreel.com/stage-contract', 303)
}
