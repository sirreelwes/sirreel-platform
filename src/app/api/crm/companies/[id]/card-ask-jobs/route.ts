/**
 * GET /api/crm/companies/[id]/card-ask-jobs — the company's jobs a card
 * request could be sent on.
 *
 * Wes, 2026-09-18: a keyed card declined and there was no way to ask for a
 * new one. The ask itself already exists and is job-scoped (the email carries
 * a portal token minted against a booking, and the recipient is ranked off
 * the job's contacts), but the screen the decline happens on — the company
 * wallet — knows only a company. This names the jobs, so the panel can offer
 * the ask instead of dead-ending on a red sentence.
 *
 * Read-only, and it sends nothing: the panel routes the staffer to the job's
 * own Card Authorization tile, which opens the SAME review modal every other
 * client email goes through. One composer, so the preview, the recipient
 * picker and the two-tap confirm cannot drift into a second copy over here.
 *
 * Gated on requireCollectionsUser, like every other route under cards/ — the
 * caller is standing in the wallet.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCollectionsUser } from '@/lib/collections/access'
import { cardAskJobsForCompany } from '@/lib/payments/jobCardOnFile'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireCollectionsUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 403 })

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ jobs: await cardAskJobsForCompany(company.id) })
}
