import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
// One canonical review for every COI surface — see src/lib/coi/reviewCoi.ts.
// This route carried its own third copy of the prompt with its own
// hard/manageable tiering; it now asks the same questions as the review desk
// and the paperwork portal.
import { runCoiAiReview } from '@/lib/coi/reviewCoi'
import { coiFlags } from '@/lib/coi/checks'
import { evaluateInsuredMatch } from '@/lib/coi/insuredMatch'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const companyName = formData.get('companyName') as string || ''
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const review: Record<string, any> = await runCoiAiReview(Buffer.from(bytes), file.type)

    // Named-insured match is computed, never asked of the model — same rule
    // as every other COI surface (src/lib/coi/insuredMatch.ts). With no
    // company typed in there is nothing to compare against, so the row is
    // reported as read-only fact rather than a failure.
    const match = companyName ? evaluateInsuredMatch(review.namedInsured ?? null, [companyName]) : null
    review.insuredName = {
      pass: !match?.needsAttention,
      found: review.namedInsured || '',
      note: match?.needsAttention ? match.message : '',
    }

    const flags = coiFlags(review)
    review.criticalPass = flags.criticalPass && !match?.needsAttention
    review.alertPass = flags.alertPass
    review.overallPass = review.criticalPass && review.alertPass
    review.requiresAdminApproval = review.criticalPass && !review.alertPass
    // Legacy names this page's older readers still use.
    review.hardPass = review.criticalPass
    review.manageablePass = review.alertPass
    review.hardIssues = review.criticalIssues ?? []
    review.manageableIssues = review.alertIssues ?? []

    return NextResponse.json({ ok: true, review })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
