import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'

export const dynamic = 'force-dynamic'

/**
 * Agent-side list of stage paperwork requests for the Stage Contract
 * Terms tool (/admin/stage-terms): every request whose contract includes
 * the studio contract, with whether the negotiated terms are set yet
 * (the v2 portal keeps the contract unsignable until they are).
 */
export async function GET(_req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const requests = await prisma.paperworkRequest.findMany({
      where: { contractType: { in: ['stage', 'both'] } },
      orderBy: { sentAt: 'desc' },
      take: 100,
      include: {
        booking: { select: { jobName: true, startDate: true, endDate: true, company: { select: { name: true } } } },
      },
    })
    const rows = requests.map((r) => {
      let sd: any = null
      try {
        sd = r.stageDetails ? JSON.parse(r.stageDetails) : null
      } catch {
        sd = null
      }
      const sets: string[] = Array.isArray(sd?.sets) ? sd.sets : []
      return {
        token: r.token,
        sentTo: r.sentTo,
        sentAt: r.sentAt,
        contractType: r.contractType,
        jobName: r.booking?.jobName || '',
        company: r.booking?.company?.name || '',
        startDate: r.booking?.startDate || null,
        endDate: r.booking?.endDate || null,
        signed: r.studioContractSigned,
        termsReady: sets.length > 0 && !!sd?.ratePerDay,
        strykerRequired: sets.includes('hospital'),
        sets,
        ratePerDay: sd?.ratePerDay || '',
      }
    })
    return NextResponse.json({ requests: rows })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
