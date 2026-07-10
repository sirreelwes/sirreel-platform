import { NextRequest, NextResponse } from 'next/server'
import { confirmJobEntry } from '@/lib/public/agreementEntry'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/agreement-entry/[token] — the Branch A "This is my job →"
 * click from the agreement-entry email. Creates NOTHING: prepares the job's
 * baseline agreement (idempotent render + release from contractClauses.ts)
 * and 303s into the job portal with a fresh magic link, where "Sign
 * agreement →" is live. Repeat clicks / forwarded links land in the SAME
 * portal. Invalid/expired → 303 to the public agreement page (no info leak;
 * the token itself is the only secret).
 */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const result = await confirmJobEntry(params.token || '')
  if (result.kind === 'redirect') return NextResponse.redirect(result.url, 303)
  // The public agreement page lives on the marketing host (the portal host
  // 404s /rental-agreement by allow-list).
  return NextResponse.redirect('https://sirreel.com/rental-agreement', 303)
}
