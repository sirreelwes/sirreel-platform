import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/scheduling/reservation-context?bookingId=…[&assignmentId=…]
 *
 * On-demand context for the gantt's reservation detail pop-up:
 *
 *   paperwork — job-level compliance rollup (rental agreement, COI,
 *     LCDW, credit-card auth, workers comp). Modern signals first
 *     (SignedAgreement rows on the job's orders, latest CoiCheck on
 *     the job), falling back to the booking's legacy booleans and the
 *     booking's PaperworkRequest completion flags (LCDW/CC-auth/WC
 *     live ONLY there).
 *
 *   driver — who physically checked the clicked unit out: the
 *     CheckoutRecord chained off the BookingAssignment, with driver
 *     identity/flags and checkout/return odometer + fuel.
 *
 *   balanceDue — open invoice balance across the job's orders.
 *
 * Read-only; fetched lazily when the modal opens so the timeline
 * payload stays lean.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const bookingId = searchParams.get('bookingId')
  const assignmentId = searchParams.get('assignmentId')
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 })

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      rentalAgreement: true,
      coiReceived: true,
      unionStatus: true,
      paperworkRequests: {
        select: {
          rentalAgreement: true,
          coiReceived: true,
          lcdwAccepted: true,
          creditCardAuth: true,
          wcReceived: true,
          completedAt: true,
        },
      },
      job: {
        select: {
          id: true,
          jobCode: true,
          assistantAuthCode: true,
          coiChecks: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { humanDecision: true, policyExpiryDate: true, coverageVerified: true },
          },
          orders: {
            where: { status: { not: 'CANCELLED' } },
            select: {
              signedAgreements: { select: { contractType: true, status: true } },
              invoices: { select: { status: true, balanceDue: true } },
            },
          },
        },
      },
    },
  })
  if (!booking) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // ── Paperwork rollup ──
  const agreements = (booking.job?.orders ?? []).flatMap((o) => o.signedAgreements)
  const rentalRows = agreements.filter((a) => a.contractType === 'RENTAL_AGREEMENT')
  const anyPrDone = (flag: keyof (typeof booking.paperworkRequests)[number]) =>
    booking.paperworkRequests.some((pr) => pr[flag] === true)

  const rental: 'signed' | 'sent' | 'missing' = rentalRows.some((a) => String(a.status).startsWith('SIGNED'))
    ? 'signed'
    : booking.rentalAgreement || anyPrDone('rentalAgreement')
      ? 'signed'
      : rentalRows.length > 0
        ? 'sent'
        : 'missing'

  const coiRow = booking.job?.coiChecks[0] ?? null
  const todayYmd = new Date().toISOString().slice(0, 10)
  let coi: 'verified' | 'pending' | 'expired' | 'rejected' | 'missing'
  if (coiRow) {
    if (coiRow.policyExpiryDate && coiRow.policyExpiryDate.toISOString().slice(0, 10) < todayYmd) coi = 'expired'
    else if (coiRow.humanDecision === 'APPROVED' || coiRow.coverageVerified) coi = 'verified'
    else if (coiRow.humanDecision === 'REJECTED') coi = 'rejected'
    else coi = 'pending'
  } else {
    coi = booking.coiReceived || anyPrDone('coiReceived') ? 'verified' : 'missing'
  }

  // LCDW / CC auth / WC exist only on PaperworkRequest completion flags.
  const hasPr = booking.paperworkRequests.length > 0
  const lcdw: 'accepted' | 'pending' | 'unknown' = anyPrDone('lcdwAccepted') ? 'accepted' : hasPr ? 'pending' : 'unknown'
  const ccAuth: 'done' | 'pending' | 'unknown' = anyPrDone('creditCardAuth') ? 'done' : hasPr ? 'pending' : 'unknown'
  const wc: 'received' | 'pending' | 'unknown' = anyPrDone('wcReceived') ? 'received' : hasPr ? 'pending' : 'unknown'

  const balanceDue = (booking.job?.orders ?? [])
    .flatMap((o) => o.invoices)
    .filter((i) => i.status !== 'VOID')
    .reduce((s, i) => s + Number(i.balanceDue || 0), 0)

  // ── Driver / checkout (assignment-scoped) ──
  let checkout: Record<string, unknown> | null = null
  if (assignmentId) {
    const rec = await prisma.checkoutRecord.findFirst({
      where: { bookingAssignmentId: assignmentId },
      orderBy: { checkoutTime: 'desc' },
      select: {
        checkoutTime: true,
        mileageOut: true,
        fuelOut: true,
        returnTime: true,
        mileageIn: true,
        fuelIn: true,
        checkedOutBy: true,
        returnedTo: true,
        driver: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            type: true,
            flagged: true,
            flagReason: true,
            licenseExpiry: true,
            totalCheckouts: true,
          },
        },
      },
    })
    if (rec) {
      checkout = {
        checkoutTime: rec.checkoutTime,
        mileageOut: rec.mileageOut,
        fuelOut: rec.fuelOut,
        returnTime: rec.returnTime,
        mileageIn: rec.mileageIn,
        fuelIn: rec.fuelIn,
        checkedOutBy: rec.checkedOutBy,
        returnedTo: rec.returnedTo,
        driver: rec.driver
          ? {
              name: `${rec.driver.firstName} ${rec.driver.lastName}`.trim(),
              phone: rec.driver.phone,
              type: rec.driver.type,
              flagged: rec.driver.flagged,
              flagReason: rec.driver.flagReason,
              licenseExpiry: rec.driver.licenseExpiry,
              totalCheckouts: rec.driver.totalCheckouts,
            }
          : null,
      }
    }
  }

  return NextResponse.json({
    ok: true,
    paperwork: { rental, coi, coiExpires: coiRow?.policyExpiryDate ?? null, lcdw, ccAuth, wc },
    unionStatus: booking.unionStatus,
    balanceDue,
    checkout,
    // 5-digit after-hours access code clients read to the assistant to verify.
    accessCode: booking.job?.assistantAuthCode ?? null,
  })
}
