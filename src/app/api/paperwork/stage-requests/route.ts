import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { STRYKER_TRIGGER_KEY, stageTermsReady, ledWallSelected } from '@/lib/contracts/stageAreas'

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
        termsReady: stageTermsReady(sd),
        ledWall: ledWallSelected(sd),
        strykerRequired: sets.includes(STRYKER_TRIGGER_KEY),
        sets,
        ratePerDay: sd?.ratePerDay || '',
      }
    })
    // "Needs stage paperwork": bookings holding a STAGES-department item
    // with NO stage|both PaperworkRequest yet — the chicken-and-egg gap
    // (a brand-new held stage job can't appear in the request list above
    // until an agent lands it via /ensure). Read-only here: nothing is
    // created on display. Wrapped so a failure never breaks the main list.
    let needsPaperwork: any[] = []
    try {
      const orphans = await prisma.booking.findMany({
        where: {
          archivedAt: null,
          status: { notIn: ['CANCELLED', 'ARCHIVED', 'RETURNED'] },
          items: { some: { category: { department: 'STAGES' } } },
          paperworkRequests: { none: { contractType: { in: ['stage', 'both'] } } },
        },
        orderBy: { startDate: 'desc' },
        take: 50,
        include: {
          company: { select: { name: true } },
          person: { select: { firstName: true, lastName: true, email: true } },
          items: { include: { category: { select: { name: true, department: true } } } },
          paperworkRequests: { select: { contractType: true }, take: 1 },
        },
      })
      needsPaperwork = orphans.map((b) => ({
        bookingId: b.id,
        jobName: b.jobName,
        company: b.company?.name || '',
        contactName: [b.person?.firstName, b.person?.lastName].filter(Boolean).join(' '),
        contactEmail: b.person?.email || '',
        startDate: b.startDate,
        endDate: b.endDate,
        status: b.status,
        fromPlanyo: !!b.planyoCartId,
        stageItems: b.items.filter((i) => i.category?.department === 'STAGES').map((i) => i.category?.name || ''),
        hasVehiclesRequest: b.paperworkRequests.some((r) => r.contractType === 'vehicles'),
      }))
    } catch (err) {
      console.error('[paperwork/stage-requests] needs-paperwork query failed (list unaffected):', err)
    }

    return NextResponse.json({ requests: rows, needsPaperwork })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
